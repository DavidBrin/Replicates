const clamp=(x,a,b)=>Math.min(Math.max(x,a),b);
const lerp=(a,b,t)=>(1-t)*a+t*b;
function maxMag(last){ return lerp(1,6,clamp((last-30)/(80-30),0,1)); } // angle factor is 1.0 because angle_rate=100
function reactionFrameMulSpeedUp(frame,last,maxM){
  let mag=maxM,i=0; const u=1-70/100;
  while(mag>1){
    let ratio=clamp((last*u-frame)/(last*u-last),0,1);
    mag=ratio*maxM;
    frame -= mag<1 ? 1 : mag;
    i++;
  }
  return i+Math.ceil(frame);
}
function effectiveHitstunFrames(kb){
  const faf=Math.floor(kb*0.4);
  const m=maxMag(faf);
  const f=reactionFrameMulSpeedUp(faf,faf,m);
  return {faf, mag:m, sped:f, hitstun:f-1};
}
for (const kb of [60,79,80,90,100,120,145,160,200,250,300]) console.log(kb, JSON.stringify(effectiveHitstunFrames(kb)), 'plain', Math.floor(kb*0.4)-1);
