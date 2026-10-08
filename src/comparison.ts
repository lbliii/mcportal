/** Explicit agent output for a temporary comparison; keeping is a separate user action. */
import { evidenceRef, type Orientation } from './collections.ts';
import { AppError } from './lib/errors.ts';
import type { LibraryHit } from './library.ts';
import type { ToolContext } from './tools/kit.ts';
export interface ComparisonInput { question: string; sources: Array<{ ref: string; title: string; docs?: string; fetchedAt?: string; excerpt?: string }>; interpretation: { text: string; refs: string[] } }
export interface ComparisonResult { question: string; sources: LibraryHit[]; orientation: Orientation }
export const COMPARISON_SCHEMA = { type:'object',required:['question','sources','interpretation'],additionalProperties:false,properties:{question:{type:'string',minLength:1,maxLength:1000},sources:{type:'array',minItems:2,maxItems:3,items:{type:'object',required:['ref','title'],additionalProperties:false,properties:{ref:{type:'string',maxLength:4100},title:{type:'string',maxLength:300},docs:{type:'string',maxLength:4096},fetchedAt:{type:'string',maxLength:40},excerpt:{type:'string',maxLength:2000}}}},interpretation:{type:'object',required:['text','refs'],additionalProperties:false,properties:{text:{type:'string',minLength:1,maxLength:16000},refs:{type:'array',minItems:1,maxItems:3,items:{type:'string',maxLength:4100}}}}} };
export async function comparison(input:ComparisonInput,ctx:ToolContext):Promise<ComparisonResult> {
  const refs=input.sources.map(s=>evidenceRef(s.ref));
  if (refs.length<2 || refs.length>3 || new Set(refs).size!==refs.length || !input.question.trim() || input.question.length>1000 || !input.interpretation.text.trim() || input.interpretation.text.length>16000) throw new AppError('invalid_argument','A comparison needs a question, two or three distinct sources and a bounded interpretation.');
  const citations=input.interpretation.refs.map(evidenceRef);
  if (!citations.length || new Set(citations).size!==citations.length || citations.some(ref=>!refs.includes(ref))) throw new AppError('invalid_argument','Every citation must name one of the comparison sources.');
  const sources:LibraryHit[]=[];
  for (const [i,s] of input.sources.entries()) {
    const ref=refs[i]!,clipId=ref.startsWith('clip:')?ref.slice(5):undefined,clip=clipId ? await ctx.clips?.get(ctx.userId,clipId) : undefined;
    // A missing clip stays missing and never renders a supplied shadow body.
    if (s.fetchedAt && !Number.isFinite(Date.parse(s.fetchedAt))) throw new AppError('invalid_argument','Invalid source fetch date.');
    const url=clipId ? clip?.source.url : ref.slice(4), fetchedAt=s.fetchedAt ? new Date(s.fetchedAt).toISOString() : new Date().toISOString();
    sources.push({ref,kind:clipId?'clip':'page',title:s.title,source:clip?.source.title || (url?new URL(url).hostname:'Unavailable clip'),...(url?{url}:{}),...(clipId?{clipId,...(clip?{clipKind:clip.kind}:{})}:{}),...(s.docs?{docs:s.docs}:{}),tags:clip?.tags || [],excerpt:clipId?'':s.excerpt || '',updatedAt:fetchedAt,saved:false,matched:[]});
  }
  return {question:input.question,sources,orientation:{text:input.interpretation.text,refs:citations,createdAt:new Date().toISOString()}};
}
