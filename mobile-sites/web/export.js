import {openDecoder,closeDecoder,seekFrame} from './pose.js';

function supportedRecorder(audio = false) {
  if (!window.MediaRecorder) return null;
  const types=audio
    ? ['video/mp4;codecs=avc1.42001f,mp4a.40.2','video/mp4','video/webm;codecs=vp8,opus','video/webm']
    : ['video/mp4;codecs=avc1.42001f','video/mp4','video/webm;codecs=vp8','video/webm'];
  return types.find(type=>MediaRecorder.isTypeSupported(type));
}

async function mp4Encoder(canvas,rate) {
  if (!window.VideoEncoder || !window.VideoFrame) return null;
  const config={codec:'avc1.42001f',width:canvas.width,height:canvas.height,
    bitrate:2_500_000,framerate:rate,avc:{format:'avc'}};
  let supported;
  try { supported=await VideoEncoder.isConfigSupported(config); } catch { return null; }
  if(!supported.supported) return null;
  const {Muxer,ArrayBufferTarget}=await import('https://cdn.jsdelivr.net/npm/mp4-muxer@5.2.2/build/mp4-muxer.mjs');
  const target=new ArrayBufferTarget(), muxer=new Muxer({
    target,video:{codec:'avc',width:canvas.width,height:canvas.height},fastStart:'in-memory'
  });
  let failure;
  const encoder=new VideoEncoder({output:(chunk,meta)=>muxer.addVideoChunk(chunk,meta),error:error=>{failure=error;}});
  encoder.configure(supported.config);
  return {
    async add(index) {
      if(failure) throw failure;
      if(encoder.encodeQueueSize>7) await encoder.flush();
      const timestamp=Math.round(index*1_000_000/rate), duration=Math.round((index+1)*1_000_000/rate)-timestamp;
      const frame=new VideoFrame(canvas,{timestamp,duration});
      try { encoder.encode(frame,{keyFrame:index%rate===0}); }
      finally { frame.close(); }
    },
    async finish() {
      await encoder.flush(); if(failure) throw failure;
      muxer.finalize(); return {blob:new Blob([target.buffer],{type:'video/mp4'}),extension:'mp4'};
    },
    close(){ if(encoder.state!=='closed') encoder.close(); }
  };
}

async function recording(canvas,video,options,type) {
  if(typeof canvas.captureStream!=='function') throw new Error('Video export is unavailable on this browser.');
  const stream=canvas.captureStream(24);
  let source,recorder;
  try {
    if(options.audioContext) {
      source=options.audioContext.createMediaElementSource(video);
      const destination=options.audioContext.createMediaStreamDestination();
      source.connect(destination);
      video.muted=false;
      for(const track of destination.stream.getAudioTracks()) stream.addTrack(track);
    }
    recorder=new MediaRecorder(stream,{mimeType:type,videoBitsPerSecond:2_500_000});
  } catch(error) {
    source?.disconnect();
    for(const track of stream.getTracks())track.stop();
    throw error;
  }
  const chunks=[];
  recorder.ondataavailable=event=>{if(event.data.size) chunks.push(event.data);};
  let error;
  const done=new Promise(resolve=>{
    recorder.onerror=event=>{error=event.error;resolve();};
    recorder.onstop=resolve;
  });
  const restore=()=>video.pause();
  try {
    await seekFrame(video,options.start,options.signal);
    options.draw(canvas,video,options.start);
    recorder.start();
    await video.play();
    const deadline=performance.now()+Math.max(10_000,(options.end-options.start+10)*1000);
    while(!video.ended && video.currentTime<options.end) {
      options.signal.throwIfAborted();
      if(error) throw error;
      if(performance.now()>deadline) throw new Error("Playback stalled while exporting. Keep this tab active and try again.");
      options.draw(canvas,video,video.currentTime);
      options.progress((video.currentTime-options.start)/(options.end-options.start));
      await new Promise(resolve=>setTimeout(resolve,25));
    }
    recorder.stop(); await done;
    if(error) throw error;
    const blob=new Blob(chunks,{type:recorder.mimeType||type});
    if(!blob.size) throw new Error('The browser returned an empty recording.');
    return {blob,extension:type.startsWith('video/mp4')?'mp4':'webm',audio:!!source};
  } finally {
    restore();
    if(recorder.state!=='inactive') recorder.stop();
    source?.disconnect();
    for(const track of stream.getTracks()) track.stop();
  }
}

export async function exportClip(options) {
  const video=await openDecoder(options.url,options.signal);
  const canvas=document.createElement('canvas'), rate=24;
  const scale=Math.min(1,960/Math.max(video.videoWidth,video.videoHeight));
  canvas.width=Math.max(2,Math.floor(video.videoWidth*scale/2)*2);
  canvas.height=Math.max(2,Math.floor(video.videoHeight*scale/2)*2);
  let encoder;
  try {
    if(!options.audioContext) {
      try { encoder=await mp4Encoder(canvas,rate); } catch {}
    }
    if(encoder) {
      try {
        const count=Math.max(1,Math.ceil((options.end-options.start)*rate));
        for(let i=0;i<count;i++) {
          const time=options.start+i/rate;
          await seekFrame(video,time,options.signal);
          options.draw(canvas,video,time);
          await encoder.add(i);
          if(i%8===0) options.progress(i/count);
        }
        options.signal.throwIfAborted();
        return await encoder.finish();
      } catch(error) {
        options.signal.throwIfAborted();
        if(!supportedRecorder()) throw error;
      }
    }
    const type=supportedRecorder(!!options.audioContext);
    if(!type) throw new Error('This browser has no supported video encoder.');
    return await recording(canvas,video,options,type);
  } finally {
    encoder?.close();
    closeDecoder(video);
  }
}
