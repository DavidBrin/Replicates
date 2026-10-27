// Reference port of SSBU combat formulas (sources: SmashWiki Knockback/Hitlag/Hitstun/Shield pages; rubendal/SSBU-Calculator (MIT) formulas.js; benhall-7 gist for damage-speed-up)
export const clamp=(x,a,b)=>Math.min(Math.max(x,a),b);
export const lerp=(a,b,t)=>(1-t)*a+t*b;
export function rage(attackerPercent){ return attackerPercent<=35?1: attackerPercent>=150?1.1: 1+(attackerPercent-35)*0.1/115; }
// staleQueue: array of up to 9 booleans (is move in queue slot i), shieldQueue: slot hit a shield
const STALE=[0.09,0.08545,0.07635,0.0679,0.05945,0.05035,0.04255,0.03345,0.025];
export function staleMult(queue=[],shieldQueue=[]){ let s=1; for(let i=0;i<queue.length;i++) if(queue[i]) s-= STALE[i]*(shieldQueue[i]?0.85:1); return (s===1)?1.05:s; }
// KB = ((((p/10 + p*d/20) * (200/(w+100)) * 1.4) + 18) * (kbg/100) + bkb) * r
export function knockback({targetPercentBefore, damage, weight, kbg, bkb, fkb=0, staleS=1, attackerPercent=0, r=1, crouchCancel=false, setWeight=false}){
  const p = targetPercentBefore + damage*staleS;            // percent after the hit (stale-adjusted damage)
  const d = damage*(1-(1-staleS)*0.3);                      // "d" uses only 0.3x of the staling
  const w = setWeight?100:weight;
  let kb;
  if (fkb>0) kb = (((1+fkb/2)*(200/(w+100))*1.4)+18)*(kbg/100)+bkb;   // fixed-KB moves: p=10, d=fkb
  else       kb = ((((p/10)+(p*d/20))*(200/(w+100))*1.4)+18)*(kbg/100)+bkb;
  kb *= r*(fkb>0?1:rage(attackerPercent))*(crouchCancel?0.85:1);       // (rage/CC not applied to set KB in Ultimate)
  return kb;
}
export const launchSpeed = kb => kb*0.03;               // initial launch speed (units/frame)
export const DECAY = 0.051;                             // per-frame decay of launch speed along the launch vector
export const isTumble = kb => Math.floor(kb*0.4)-1+1 >= 32; // hitstun+1 >= 32  <=> kb >= 80
export function hitstunBase(kb, modifierFrames=0){ const h=Math.max(5, kb*0.4); return Math.floor(h)-1+modifierFrames; }  // min 5 pre-floor for non-windbox
export function sakuraiAngle(kb, aerial){ if(aerial) return 38; if(kb<60) return 0; if(kb>=88) return 38; return Math.min((kb-60)/(88-60)*38+1,38); }
// "Balloon knockback" (damage_speed_up): returns real frames of hitstun
export function speedUp(kb){
  const last=Math.floor(kb*0.4); const maxM=lerp(1,6,clamp((last-30)/50,0,1)); // angle term is a no-op: damage_fly_speed_up_angle_rate=100
  let frame=last, mag=maxM, n=0; const u=0.3;
  while(mag>1){ const ratio=clamp((last*u-frame)/(last*u-last),0,1); mag=ratio*maxM; frame-= mag<1?1:mag; n++; }
  return {framesWithSpeedUp:n+Math.ceil(frame), maxMag:maxM};
}
// Hitlag: floor(floor(floor((d*0.65+6)*h*e*s)*p)*c)   d=stale damage, h=move mult, e=1.5 electric, s=0.67 shield, p=player-count, c=0.67 crouch
const PC={2:1.0,3:0.925,4:0.862,5:0.8116,6:0.77464,7:0.752464,8:0.75};
export function hitlag({damage,h=1,electric=false,shield=false,players=2,crouch=false}){
  let H=Math.floor((damage*0.65+6)*h*(electric?1.5:1)*(shield?0.67:1)); H=Math.min(H,30);
  if(H>10){ const pc=PC[players]; H=Math.floor(H*(1-((H-10)/20)*(1-pc))); }   // wiki: p = 1-((H-10)/20)(1-pc) (H capped at 30)
  return Math.floor(H*(crouch?0.67:1));
}
export function shieldstun(damage, mult=1, {projectile=false,smash=false,aerial=false}={}){ let m=mult; if(projectile&&mult===1) m=0.29; else if(aerial) m*=0.33; else if(smash) m*=0.725; return Math.floor(damage*0.8*m+3)-1; }
export function shieldDamage(damage, bonus=0){ return (damage+bonus)*1.19; }
export function shieldPushback(shieldstun_, perfect=false){ return Math.min((shieldstun_+1)*0.09*(perfect?0.15:1),1.3); }
// DI: stick (x,y) in [-1,1] after 24/120 deadzone; launch vector (lx,ly)
export function di(lx,ly,sx,sy){ const L=Math.hypot(lx,ly); if(L<1e-5) return Math.atan2(ly,lx); const a=Math.atan2(ly,lx); if(Math.abs(a)<0.17) return a;
  const cross=sy*lx - sx*ly; const variation=Math.abs(sx*ly - sy*lx)/L; const d=0.17*variation; return cross<0? a-d : a+d; }
export function lsi(sy,angleDeg){ if((angleDeg>65&&angleDeg<115)||(angleDeg>245&&angleDeg<295)) return 1; return sy>=0? 1+0.095*sy : 1-0.08*(-sy); }
export function jumpVelAfterInitial(g,h,i){ return Math.sqrt(2*g*(h-i))+g/2; } // full hop: first 4 frames cover i=0.55h, then this
export function jumpVelShort(g,h){ return Math.sqrt(2*g*h)+g/2; }                // short hop / air jump
export function airJumpVel(g,h){ return Math.sqrt(2*g*h)+g/2; }
