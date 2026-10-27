// Toy proxy benchmark: N fighters, per-tick physics + worst-case all-hitboxes-active sphere tests + KB formula + snapshot copy.
// Not a real engine; gives an order-of-magnitude CPU cost per 60 Hz tick in V8.
const N = Number(process.argv[2]||4);
const FIELDS = 64; // floats per fighter in state (pos, vel, timers, flags...)
const state = new Float64Array(N*FIELDS);
const snap = new Float64Array(N*FIELDS);
const HURT = 14, HIT = 4;               // hurtbubbles per fighter, active hitbubbles per attacker (worst case: all attacking)
const hurt = new Float64Array(N*HURT*4); // x,y,z,r
const hit  = new Float64Array(N*HIT*4);
let seed = 12345; const rnd=()=> (seed = (seed*1664525+1013904223)>>>0)/4294967296;
for (let i=0;i<state.length;i++) state[i]=rnd();
const platforms = []; for (let i=0;i<8;i++) platforms.push([rnd()*100-50, rnd()*40, 35]);
function kb(p,d,w,kbg,bkb){ return ((((p/10 + p*d/20) * (200/(w+100)) * 1.4) + 18) * (kbg/100) + bkb); }
function tick(){
  for (let f=0; f<N; f++){
    const o=f*FIELDS;
    // physics
    let vx=state[o+2], vy=state[o+3], x=state[o], y=state[o+1];
    vy -= 0.087; if (vy < -1.5) vy = -1.5;
    vx *= 0.985; x += vx; y += vy;
    for (let k=0;k<platforms.length;k++){ const pl=platforms[k]; if (vy<0 && y<=pl[1] && y-vy>pl[1] && x>pl[0]-pl[2]/2 && x<pl[0]+pl[2]/2){ y=pl[1]; vy=0; } }
    state[o]=x; state[o+1]=y; state[o+2]=vx; state[o+3]=vy;
    // hitbox/hurtbox
    for (let h=0; h<HIT; h++){
      const hx=state[o]+rnd()*10-5, hy=state[o+1]+rnd()*10, hz=0, hr=4;
      hit[(f*HIT+h)*4]=hx; hit[(f*HIT+h)*4+1]=hy; hit[(f*HIT+h)*4+3]=hr;
    }
  }
  let hits=0;
  for (let a=0;a<N;a++) for (let h=0;h<HIT;h++){
    const hb=(a*HIT+h)*4;
    for (let v=0; v<N; v++){ if (v===a) continue;
      const base=v*FIELDS;
      for (let u=0;u<HURT;u++){
        const dx=hit[hb]-(state[base]+u*0.7), dy=hit[hb+1]-(state[base+1]+u*0.5), r=hit[hb+3]+3;
        if (dx*dx+dy*dy < r*r){ hits++; const k=kb(state[base+4]*150, 10, 98, 90, 30); state[base+5]=k*0.03; break; }
      }
    }
  }
  return hits;
}
function snapshot(){ snap.set(state); }
function restore(){ state.set(snap); }
// warm
for (let i=0;i<20000;i++) tick();
const T=200000; let t0=process.hrtime.bigint(); let hits=0;
for (let i=0;i<T;i++) hits+=tick();
let t1=process.hrtime.bigint();
const us=(Number(t1-t0)/1e3)/T;
t0=process.hrtime.bigint(); for(let i=0;i<T;i++){snapshot();restore();} t1=process.hrtime.bigint();
const us2=(Number(t1-t0)/1e3)/T;
console.log(`N=${N} fighters: tick ${us.toFixed(2)} us  snapshot+restore ${us2.toFixed(3)} us  (hits ${hits})`);
console.log(`60 Hz load: ${(us*60/1e4).toFixed(3)} % of one core; 8-frame rollback resim worst case: ${(us*8).toFixed(1)} us (${(us*8/16666*100).toFixed(2)} % of a 16.7 ms frame)`);
