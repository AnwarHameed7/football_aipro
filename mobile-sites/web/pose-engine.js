const PACKAGE='@mediapipe/tasks-vision@0.10.22-rc.20250304';
const CDNS=['https://unpkg.com','https://cdn.jsdelivr.net/npm'];
const MODELS='https://storage.googleapis.com/mediapipe-models';
const MOVE_NET='https://www.kaggle.com/models/google/movenet/tfJs/multipose-lightning/1/model.json?tfjs-format=file';

export class PoseEngineError extends Error {}

export function modelWithin(promise,signal,timeout,onLateResult) {
  return new Promise((resolve,reject)=>{
    let settled=false;
    const finish=(error,result)=>{
      if(settled) {
        if(result)onLateResult?.(result);
        return;
      }
      settled=true;
      clearTimeout(timer);
      signal?.removeEventListener('abort',cancel);
      if(error)reject(error);else resolve(result);
    };
    const cancel=()=>finish(signal.reason);
    const timer=setTimeout(()=>finish(new Error('The analysis model took too long to load.')),timeout);
    promise.then(result=>finish(null,result),finish);
    if(signal?.aborted)cancel();else signal?.addEventListener('abort',cancel,{once:true});
  });
}

async function mediaPipeOptions(root,compatible) {
  const library=await import(`${root}/vision_bundle.mjs`);
  const files=compatible?{
    wasmLoaderPath:`${root}/wasm/vision_wasm_nosimd_internal.js`,
    wasmBinaryPath:`${root}/wasm/vision_wasm_nosimd_internal.wasm`,
  }:await library.FilesetResolver.forVisionTasks(`${root}/wasm`);
  return {library,files};
}

async function createMediaPipe(kind,compatible,signal) {
  for(const cdn of CDNS) {
    try {
      const pending=(async()=>{
        const {library,files}=await mediaPipeOptions(`${cdn}/${PACKAGE}`,compatible);
        const canvas=document.createElement('canvas');
        if(kind==='pose') return library.PoseLandmarker.createFromOptions(files,{
          baseOptions:{delegate:'CPU',modelAssetPath:`${MODELS}/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task`},
          canvas,runningMode:'IMAGE',numPoses:compatible?3:4,outputSegmentationMasks:!compatible,
          minPoseDetectionConfidence:.55,minPosePresenceConfidence:.55,
        });
        return library.ObjectDetector.createFromOptions(files,{
          baseOptions:{delegate:'CPU',modelAssetPath:`${MODELS}/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite`},
          canvas,runningMode:'IMAGE',categoryAllowlist:kind==='ball'?['sports ball']:['person','sports ball'],
          scoreThreshold:kind==='ball'?.45:.35,maxResults:40,
        });
      })();
      return await modelWithin(pending,signal,kind==='ball'?12000:20000,closeModel);
    } catch {
      signal?.throwIfAborted();
    }
  }
  throw new PoseEngineError('The analysis engine could not start.');
}

export function closeModel(detector) {
  try {detector.close();} catch { /* An aborted runtime may already be closed. */ }
}

export function appleMobile() {
  return /iP(?:hone|ad|od)/i.test(navigator.userAgent) ||
    (/Mac/i.test(navigator.platform||'') && navigator.maxTouchPoints>1);
}

export const objectModel=(kind,signal)=>createMediaPipe(kind,appleMobile(),signal);

let tfRuntime, moveNetModel;
function loadScript(url) {
  return new Promise((resolve,reject)=>{
    const script=document.createElement('script');
    const finish=error=>{
      clearTimeout(timer);
      script.remove();
      if(error) reject(error);else resolve();
    };
    const fail=()=>finish(new Error('The compatibility model library could not load.'));
    const timer=setTimeout(fail,12000);
    script.src=url;script.onload=()=>finish();script.onerror=fail;
    document.head.append(script);
  });
}
async function tensorRuntime() {
  for(const cdn of CDNS) {
    try {
      await loadScript(`${cdn}/@tensorflow/tfjs@4.22.0/dist/tf.min.js`);
      const tf=globalThis.tf;
      await tf.setBackend('cpu');
      await tf.ready();
      return tf;
    } catch { /* Try the second CDN. */ }
  }
  throw new PoseEngineError('The compatibility model library could not load.');
}

const BODY_POINTS=[0,2,5,7,8,11,12,13,14,15,16,23,24,25,26,27,28];

export async function moveNetLandmarks(tf,model,pixels,width,height) {
  const scale=256/Math.max(width,height);
  const w=Math.round(width*scale),h=Math.round(height*scale);
  const paddedW=Math.ceil(w/32)*32,paddedH=Math.ceil(h/32)*32;
  const input=tf.tidy(()=>{
    const resized=tf.image.resizeBilinear(tf.browser.fromPixels(pixels),[h,w]);
    return tf.pad(resized,[[0,paddedH-h],[0,paddedW-w],[0,0]]).cast('int32').expandDims(0);
  });
  let output;
  try {
    output=model.execute(input);
    if(output.shape?.length!==3||output.shape[0]!==1||output.shape[2]!==56)
      throw new PoseEngineError('The compatibility model returned an unexpected result.');
    const values=await output.data();
    const landmarks=[];
    for(let offset=0;offset+55<values.length;offset+=56) {
      if(values[offset+55]<.30)continue;
      const points=Array.from({length:33},()=>({x:0,y:0,z:0,visibility:0}));
      BODY_POINTS.forEach((index,i)=>{
        const base=offset+i*3;
        points[index]={x:values[base+1]*paddedW/w,y:values[base]*paddedH/h,z:0,visibility:values[base+2]};
      });
      landmarks.push(points);
    }
    return {landmarks,worldLandmarks:[]};
  } finally {
    input.dispose();
    if(output)tf.dispose(output);
  }
}

async function cpuPose(signal) {
  tfRuntime ||= tensorRuntime().catch(error=>{tfRuntime=null;throw error;});
  const tf=await modelWithin(tfRuntime,signal,27000);
  if(!moveNetModel) {
    const controller=new AbortController();
    moveNetModel=modelWithin(tf.loadGraphModel(MOVE_NET,{requestInit:{signal:controller.signal}}),
      null,35000,model=>model.dispose()).catch(error=>{
      controller.abort();moveNetModel=null;throw error;
    });
  }
  const model=await modelWithin(moveNetModel,signal,35000);
  return {
    compatibility:true,ballSupported:false,close(){},
    async read(image,onResult) {onResult(await moveNetLandmarks(tf,model,image,image.width,image.height));},
  };
}

async function openPose(mode,signal) {
  if(mode==='cpu')return cpuPose(signal);
  const detector=await createMediaPipe('pose',mode==='simple',signal);
  return {
    compatibility:mode==='simple',ballSupported:true,close:()=>closeModel(detector),
    read(image,onResult) {detector.detect(image,onResult);},
  };
}

export async function withPoseFallback(run,{signal,compatible,onRetry,open=openPose}) {
  const modes=compatible?['simple','cpu']:['full','simple','cpu'];
  for(const [index,mode] of modes.entries()) {
    signal.throwIfAborted();
    let engine;
    try {
      if(index)onRetry?.();
      try {engine=await open(mode,signal);}
      catch {throw new PoseEngineError('The pose model could not start.');}
      return await run(engine);
    } catch(error) {
      signal.throwIfAborted();
      if(!(error instanceof PoseEngineError))throw error;
      if(index===modes.length-1)throw new Error(
        'The pose models could not run on this device. Reload the page in Safari and try tracking a short clip.');
    } finally {
      engine?.close();
    }
  }
}
