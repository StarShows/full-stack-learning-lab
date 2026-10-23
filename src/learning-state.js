import {loadProgress} from './account-progress.js';
import {LESSONS,UNITS} from './lessons.js';
export const LEARN_KEY='alex-fullstack-learn-v1';
export const today=(now=Date.now())=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));
export const newLearningState=()=>({version:1,view:'home',unit:UNITS[0].id,activeLesson:null,drafts:{},completed:{},xp:0,days:{},lastAward:0});
export const newDraft=lesson=>({step:0,code:lesson.code.starter,quizSelection:null,quizPassed:false,codePassed:false,recallSelection:null,recallPassed:false,hints:0,wrongAttempts:0,attempts:0,usedSolution:false,startedAt:Date.now(),finished:false});
export function readLearningState(){try{const value=loadProgress('learning');if(value?.version!==1||!value.drafts||!value.completed||!value.days||!Number.isFinite(value.xp))return newLearningState();return{...newLearningState(),...value,view:['home','lesson','complete','review'].includes(value.view)?value.view:'home',unit:UNITS.some(u=>u.id===value.unit)?value.unit:UNITS[0].id};}catch{return newLearningState();}}
export function finishLesson(state,lessonId,now=Date.now()){
 const draft=state.drafts[lessonId];if(!draft||draft.finished||!draft.quizPassed||!draft.codePassed||!draft.recallPassed)return state;
 const day=today(now),old=state.completed[lessonId],award=!old?20:old.lastReviewDay!==day?5:0;
 const reviewCount=(old?.reviewCount||0)+(old?1:0),needsReview=draft.wrongAttempts>0||draft.hints>0||draft.usedSolution;
 const delays=[1,3,7,14],nextReviewAt=now+delays[Math.min(reviewCount,3)]*86400000;
 return{...state,view:'complete',xp:state.xp+award,lastAward:award,completed:{...state.completed,[lessonId]:{completedAt:old?.completedAt||now,lastPracticeAt:now,needsReview,reviewCount,nextReviewAt,lastReviewDay:day}},days:{...state.days,[day]:[...new Set([...(state.days[day]||[]),lessonId])]},drafts:{...state.drafts,[lessonId]:{...draft,finished:true}}};
}
export const nextLesson=state=>LESSONS.find(l=>!state.completed[l.id])||null;
export const dueReviews=(state,now=Date.now())=>LESSONS.filter(l=>state.completed[l.id]&&(state.completed[l.id].needsReview||state.completed[l.id].nextReviewAt<=now));
