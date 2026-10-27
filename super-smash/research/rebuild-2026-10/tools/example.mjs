import * as R from './ssbu_ref.mjs';
// illustrative move: 12% damage, KBG 100, BKB 30, angle 361 (Sakurai) used on Mario (98) at 100%, attacker at 0%
for (const [pct,w] of [[0,98],[60,98],[100,98],[100,62],[100,135]]){
  const kb=R.knockback({targetPercentBefore:pct,damage:12,weight:w,kbg:100,bkb:30});
  const sp=R.speedUp(kb);
  console.log(`target ${pct}% w=${w}: KB=${kb.toFixed(1)} launch=${R.launchSpeed(kb).toFixed(2)}u/f tumble=${R.isTumble(kb)} hitstunPlain=${R.hitstunBase(kb)} hitstunBalloon=${R.isTumble(kb)?sp.framesWithSpeedUp-1:R.hitstunBase(kb)} sakurai(ground)=${R.sakuraiAngle(kb,false).toFixed(1)}deg hitlag(12%)=${R.hitlag({damage:12})}`);
}
console.log('weight factor 200/(w+100): w62',(200/162).toFixed(3),'w98',(200/198).toFixed(3),'w135',(200/235).toFixed(3));
// jump arc sanity for Mario: g=0.087 h=36.33 initial=0.55h
const g=0.087,h=36.33,i=0.55*h; const v0=R.jumpVelAfterInitial(g,h,i); console.log('Mario full hop post-initial v0',v0.toFixed(4),'short hop v0',R.jumpVelShort(g,17.54).toFixed(4));
