import {openDecoder,closeDecoder,seekFrame} from './pose.js';

function supportedRecorder(audio = false) {
  if (!window.MediaRecorder) return null;
  const types=audio
    ? ['video/mp4;codecs=avc1.42001f,mp4a.40.2','video/mp4','video/webm;codecs=vp8,opus','video/webm']
    : ['video/mp4;codecs=avc1.42001f','video/mp4','video/webm;codecs=vp8','video/webm'];
  return types.find(type=>MediaRecorder.isTypeSupported(type));
}

async function mp4Encoder(canvas,rate,audio) {
  if (!window.VideoEncoder || !window.VideoFrame) return null;
  const config={codec:'avc1.42001f',width:canvas.width,height:canvas.height,
    bitrate:2_500_000,framerate:rate,avc:{format:'avc'}};
  let supported;
  try { supported=await VideoEncoder.isConfigSupported(config); } catch { return null; }
  if(!supported.supported) return null;
  let audioConfig;
  if(audio) {
    if(!window.AudioEncoder||!window.AudioData)return null;
    const match=await AudioEncoder.isConfigSupported({
      codec:'mp4a.40.2',sampleRate:audio.sampleRate,numberOfChannels:2,bitrate:128000
    });
    if(!match.supported)return null;
    audioConfig=match.config;
  }
  const {Muxer,ArrayBufferTarget}=await import('https://cdn.jsdelivr.net/npm/mp4-muxer@5.2.2/build/mp4-muxer.mjs');
  const target=new ArrayBufferTarget(), muxer=new Muxer({
    target,video:{codec:'avc',width:canvas.width,height:canvas.height},
    ...(audio?{audio:{codec:'aac',sampleRate:audio.sampleRate,numberOfChannels:2}}:{}),
    firstTimestampBehavior:'offset',fastStart:'in-memory'
  });
  let failure;
  const encoder=new VideoEncoder({output:(chunk,meta)=>muxer.addVideoChunk(chunk,meta),error:error=>{failure=error;}});
  let audioEncoder;
  try {
    encoder.configure(supported.config);
    if(audioConfig) {
      audioEncoder=new AudioEncoder({output:(chunk,meta)=>muxer.addAudioChunk(chunk,meta),error:error=>{failure=error;}});
      audioEncoder.configure(audioConfig);
    }
  } catch(error) {
    if(encoder.state!=='closed')encoder.close();
    if(audioEncoder&&audioEncoder.state!=='closed')audioEncoder.close();
    throw error;
  }
  return {
    async add(index) {
      if(failure) throw failure;
      if(encoder.encodeQueueSize>7) await encoder.flush();
      const timestamp=Math.round(index*1_000_000/rate), duration=Math.round((index+1)*1_000_000/rate)-timestamp;
      const frame=new VideoFrame(canvas,{timestamp,duration});
      try { encoder.encode(frame,{keyFrame:index%rate===0}); }
      finally { frame.close(); }
    },
    async finish(signal) {
      await encoder.flush();
      if(audioEncoder) {
        for(let offset=0;offset<audio.left.length;offset+=1024) {
          signal.throwIfAborted();
          if(failure)throw failure;
          if(audioEncoder.encodeQueueSize>12)await audioEncoder.flush();
          const count=Math.min(1024,audio.left.length-offset),samples=new Float32Array(count*2);
          samples.set(audio.left.subarray(offset,offset+count));
          samples.set(audio.right.subarray(offset,offset+count),count);
          const data=new AudioData({format:'f32-planar',sampleRate:audio.sampleRate,numberOfFrames:count,
            numberOfChannels:2,timestamp:Math.round(offset*1_000_000/audio.sampleRate),data:samples});
          try { audioEncoder.encode(data); } finally {data.close();}
        }
        await audioEncoder.flush();
      }
      signal.throwIfAborted();
      if(failure)throw failure;
      muxer.finalize();
      return {blob:new Blob([target.buffer],{type:'video/mp4'}),extension:'mp4',audio:audio?.original,
        narration:audio?.narration,skipped:audio?.skipped};
    },
    close(){
      if(encoder.state!=='closed')encoder.close();
      if(audioEncoder&&audioEncoder.state!=='closed')audioEncoder.close();
    }
  };
}

export function clipNarrationWindow(noteStart,noteDuration,clipStart,clipEnd) {
  const begin=Math.max(noteStart,clipStart),end=Math.min(noteStart+noteDuration,clipEnd);
  return end>begin?{delay:begin-clipStart,offset:begin-noteStart,duration:end-begin}:null;
}

async function prepareNarration(context,notes,start,end,signal) {
  const voices=[];let skipped=0;
  for(const candidate of (notes||[]).slice(0,8)) {
    signal.throwIfAborted();
    try {
      const bytes=Uint8Array.from(atob(candidate.audio.split(',')[1]),character=>character.charCodeAt(0));
      const buffer=await context.decodeAudioData(bytes.buffer);
      const span=clipNarrationWindow(candidate.start,buffer.duration,start,end);
      if(span)voices.push({buffer,...span});
    } catch { skipped++; }
  }
  return {voices,skipped};
}

export function mixPcmTracks(sampleRate,duration,parts) {
  const length=Math.ceil(sampleRate*duration),left=new Float32Array(length),right=new Float32Array(length);
  for(const {buffer,offset,delay,duration:span,gain} of parts) {
    const first=Math.max(0,Math.round(offset*sampleRate)),target=Math.max(0,Math.round(delay*sampleRate));
    const count=Math.min(length-target,buffer.length-first,Math.ceil(span*sampleRate));
    if(count<=0)continue;
    const a=buffer.getChannelData(0),b=buffer.numberOfChannels>1?buffer.getChannelData(1):a;
    for(let i=0;i<count;i++) {
      left[target+i]+=a[first+i]*gain;
      right[target+i]+=b[first+i]*gain;
    }
  }
  for(let i=0;i<length;i++) {
    left[i]=Math.max(-1,Math.min(1,left[i]));right[i]=Math.max(-1,Math.min(1,right[i]));
  }
  return {left,right};
}

async function offlineAudio(options) {
  const {audioContext:ctx,start,end,signal}=options;
  const duration=end-start;
  const {voices,skipped}=await prepareNarration(ctx,options.voiceNotes,start,end,signal);
  const parts=voices.map(voice=>({...voice,gain:.75}));
  let original=false;
  if(options.includeOriginal!==false) {
    const file=options.sourceFile;
    if(!file||file.size>32*1024*1024)
      throw new Error('The fallback can decode source audio for files up to 32 MB. Try a shorter input clip.');
    signal.throwIfAborted();
    let source;
    try {source=await ctx.decodeAudioData(await file.arrayBuffer());}
    catch {throw new Error('Could not decode the original audio. Try an H.264/AAC MP4 or turn off original audio.');}
    signal.throwIfAborted();
    parts.push({buffer:source,offset:start,delay:0,duration,gain:voices.length?.62:1});
    original=true;
  }
  if(!parts.length)throw new Error('No playable voice notes match this clip interval.');
  return {sampleRate:ctx.sampleRate,...mixPcmTracks(ctx.sampleRate,duration,parts),original,narration:voices.length,skipped};
}

async function encodeFrames(encoder,canvas,video,options,rate) {
  const count=Math.max(1,Math.ceil((options.end-options.start)*rate));
  for(let i=0;i<count;i++) {
    const time=options.start+i/rate;
    await seekFrame(video,time,options.signal);
    options.draw(canvas,video,time);
    await encoder.add(i);
    if(i%8===0)options.progress(i/count);
  }
  return encoder.finish(options.signal);
}

async function recording(canvas,video,options,type) {
  if(typeof canvas.captureStream!=='function') throw new Error('Video export is unavailable on this browser.');
  const stream=canvas.captureStream(24);
  let source,recorder,output,narration={voices:[],skipped:0};
  const scheduled=[];
  try {
    if(options.audioContext) {
      const ctx=options.audioContext;
      output=ctx.createMediaStreamDestination();
      narration=await prepareNarration(ctx,options.voiceNotes,options.start,options.end,options.signal);
      options.signal.throwIfAborted();
      if(options.includeOriginal!==false) {
        source=ctx.createMediaElementSource(video);
        if(narration.voices.length) {
          const gain=ctx.createGain();
          gain.gain.value=.62;
          source.connect(gain);gain.connect(output);
        } else source.connect(output);
        video.muted=false;
      }
      if(!source&&!narration.voices.length)
        throw new Error('No playable voice notes match this clip interval.');
      for(const track of output.stream.getAudioTracks()) stream.addTrack(track);
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
    const startTime=options.audioContext?.currentTime??0;
    for(const voice of narration.voices) {
      const voiceSource=options.audioContext.createBufferSource(),gain=options.audioContext.createGain();
      const advance=Math.max(0,video.currentTime-options.start-voice.delay);
      if(advance>=voice.duration)continue;
      voiceSource.buffer=voice.buffer;gain.gain.value=.75;
      voiceSource.connect(gain);gain.connect(output);
      voiceSource.start(startTime+Math.max(0,voice.delay-(video.currentTime-options.start)),
        voice.offset+advance,voice.duration-advance);
      scheduled.push(voiceSource);
    }
    const deadline=performance.now()+Math.max(10_000,(options.end-options.start+10)*1000);
    while(!video.ended && video.currentTime<options.end) {
      options.signal.throwIfAborted();
      if(error) throw error;
      if(performance.now()>deadline) throw new Error("Playback stalled while exporting. Keep this tab active and try again.");
      options.draw(canvas,video,video.currentTime);
      options.progress((video.currentTime-options.start)/(options.end-options.start));
      await new Promise(resolve=>setTimeout(resolve,25));
    }
    recorder.stop();
    let timer;
    try {
      await Promise.race([done,new Promise((_,reject)=>{timer=setTimeout(
        ()=>reject(new Error('The browser did not finish writing the export.')),5000);})]);
    } finally {clearTimeout(timer);}
    if(error) throw error;
    const blob=new Blob(chunks,{type:recorder.mimeType||type});
    if(!blob.size) throw new Error('The browser returned an empty recording.');
    return {blob,extension:type.startsWith('video/mp4')?'mp4':'webm',audio:!!source,narration:scheduled.length,skipped:narration.skipped};
  } finally {
    restore();
    for(const voice of scheduled){try{voice.stop();}catch{}voice.disconnect();}
    if(recorder.state!=='inactive') recorder.stop();
    source?.disconnect();
    for(const track of stream.getTracks()) track.stop();
  }
}

export async function exportClip(options) {
  const video=await openDecoder(options.url,options.signal);
  const canvas=document.createElement('canvas'),rate=24;
  const scale=Math.min(1,960/Math.max(video.videoWidth,video.videoHeight));
  canvas.width=Math.max(2,Math.floor(video.videoWidth*scale/2)*2);
  canvas.height=Math.max(2,Math.floor(video.videoHeight*scale/2)*2);
  let encoder,failure;
  try {
    const type=supportedRecorder(!!options.audioContext);
    if(!options.audioContext) {
      try {
        encoder=await mp4Encoder(canvas,rate);
        if(encoder)return await encodeFrames(encoder,canvas,video,options,rate);
      } catch(error) {options.signal.throwIfAborted();failure=error;}
    }
    if(type&&typeof canvas.captureStream==='function'&&(!options.audioContext||options.audioContext.state==='running')) {
      try {return await recording(canvas,video,options,type);}
      catch(error) {options.signal.throwIfAborted();failure=error;}
    }
    if(options.audioContext&&window.VideoEncoder&&window.AudioEncoder) {
      options.signal.throwIfAborted();
      options.onFallback?.();
      const audio=await offlineAudio(options);
      encoder=await mp4Encoder(canvas,rate,audio);
      if(encoder)return await encodeFrames(encoder,canvas,video,options,rate);
    }
    throw failure||new Error('This browser cannot export this audio and video combination. Try exporting without audio.');
  } finally {
    encoder?.close();
    closeDecoder(video);
  }
}
