import type { Kit, Question } from './study';

/** Repeatable variants keep an even spread across every lecture with questions. */
export function coursePractice(kits:Kit[],variant:number):Kit {
  const sources=kits.filter(k=>k.questions.length&&!k.id.startsWith('course-practice-'));
  if(!sources.length)throw new Error('Add questions to a course kit first.');
  const subject=sources[0].subject;
  let hash=2166136261;
  for(const char of subject)hash=Math.imul(hash^char.charCodeAt(0),16777619)>>>0;
  let seed=(hash+variant*7919)>>>0;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  const decks=sources.map(kit=>{
    const copy=kit.questions.map(q=>({...q,id:crypto.randomUUID()}));
    for(let i=copy.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[copy[i],copy[j]]=[copy[j],copy[i]];}
    return copy;
  });
  const questions:Question[]=[];
  let round=0;
  while(questions.length<30&&decks.some(d=>d.length>round)){
    for(const deck of decks){if(deck[round]&&questions.length<30)questions.push(deck[round]);}round++;
  }
  return {id:`course-practice-${hash}-${variant}`,title:`${subject} · Practice variant ${variant}`,subject,color:sources[0].color,source:sources.map(k=>`# ${k.title}\n${k.source}`).join('\n\n').slice(0,120000),summary:`A ${questions.length}-question practice variant drawn across ${sources.length} course ${sources.length===1?'kit':'kits'}. Questions come from your existing bank.`,guide:`# ${subject}: practice variant ${variant}\n\nThis revision set draws questions from:\n\n${sources.map(k=>`- ${k.title}`).join('\n')}\n\nUse Practice test for a timed attempt, or Smart practice for explanations after each question. Variants remix existing questions; small question banks will overlap. Source text may be shortened in large combined courses.`,cards:[],questions,updatedAt:Date.now(),demo:sources.every(k=>k.demo)};
}
