import fs from 'node:fs'; import vm from 'node:vm';
import * as R from './ssbu_ref.mjs';
const src=fs.readFileSync('../gh/ssbucalc_formulas.js','utf8').replace(/^﻿/,'');
const ctx={Math,console}; vm.createContext(ctx); vm.runInContext('class Knockback{constructor(kb){this.base_kb=kb;}}; this.Knockback=Knockback;',ctx); vm.runInContext(src+'\n;this.VSKB=VSKB;this.Hitlag=Hitlag;this.ShieldStun=ShieldStun;this.Rage=Rage;this.StaleNegation=StaleNegation;this.GetSpeedUpFAF=GetSpeedUpFAF;',ctx);
let maxdiff=0,n=0;
function rnd(a,b){return a+Math.random()*(b-a);}
for(let i=0;i<20000;i++){
  const pct=Math.floor(rnd(0,200)), dmg=rnd(1,25), w=Math.floor(rnd(62,135)), kbg=Math.floor(rnd(20,120)), bkb=Math.floor(rnd(0,80)), ap=Math.floor(rnd(0,200));
  const q=[Math.random()<.3,Math.random()<.3,false,false,false,false,false,false,false]; const sq=[false,false,false,false,false,false,false,false,false];
  const s=R.staleMult(q,sq);
  // calc: VSKB(percent(before hit? they pass target percent BEFORE), base_damage, damage(=base_damage), weight,kbg,bkb,gravity,fall_speed,r,queue,shieldQueue,ignoreStale,attacker_percent,angle,in_air,windbox,electric,set_weight,stick,dddinhale,launch_rate)
  const k1=ctx.VSKB(pct,dmg,dmg,w,kbg,bkb,0.1,1.6,1,q,sq,false,ap,45,true,false,false,false,{x:0,y:0},false,1).base_kb;
  const k2=R.knockback({targetPercentBefore:pct,damage:dmg,weight:w,kbg,bkb,staleS:s,attackerPercent:ap});
  maxdiff=Math.max(maxdiff,Math.abs(k1-k2)); n++;
}
console.log('KB max abs diff over',n,'random cases:',maxdiff);
// hitlag
let hd=0; for(let i=0;i<5000;i++){ const d=rnd(1,30),h=[0.5,0.7,1,1.25,1.5][i%5],e=Math.random()<.2; const a=ctx.Hitlag(d,h,e,1,false,2,false); const b=R.hitlag({damage:d,h,electric:e,players:2}); if(a!==b){hd++;} } console.log('hitlag mismatches (2p, no crouch/shield):',hd);
// shield stun
let sd=0; for(let i=0;i<5000;i++){ const d=rnd(1,30); const a=ctx.ShieldStun(d,1,false,false,false,false,false); const b=R.shieldstun(d); if(a!==b) sd++; } console.log('shieldstun mismatches:',sd);
// speed up
let su=0; for(let kb=60;kb<400;kb+=1){ const a=ctx.GetSpeedUpFAF(Math.floor(kb*0.4),90); const b=R.speedUp(kb).framesWithSpeedUp; if(a!==b) su++; } console.log('speedup mismatches kb 60..400:',su);
console.log('Wiki examples: 15% dmg hitlag =',R.hitlag({damage:15}),'(wiki: 15)');
console.log('Ultimate tumble threshold: kb 79.9 ->',R.isTumble(79.9),' kb 80 ->',R.isTumble(80));
