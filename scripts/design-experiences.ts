/** Optional-task fixtures shared by the visual host and density regression tests. */
import type {LibraryResult} from '../src/library.ts';
import type {Collection} from '../src/collections.ts';
import type {CollectionData} from '../src/collection-service.ts';
import type {ComparisonResult} from '../src/comparison.ts';
import type {CatchupSession} from '../src/experiences.ts';
import type {WatchResult} from '../src/reading-watches.ts';

const at='2026-10-10T12:00:00Z';
const library:LibraryResult={query:'',total:6,offset:0,nextOffset:null,hits:Array.from({length:6},(_,i)=>({ref:`url:https://example.com/guide-${i}`,kind:'page',title:['A room for your internet','Keeping useful context','Reading across sources','Small tools and quiet interfaces','Working with saved material','Designing with intention'][i]!,source:'example.com',url:`https://example.com/guide-${i}`,tags:[],excerpt:'Useful reading deserves space. A short excerpt lets you scan the material before opening the complete source in the reader.',updatedAt:at,saved:true,matched:['Saved title']}))};
const collection:Collection={id:'col_design',kind:'desk',title:'Quiet interfaces',purpose:'How can useful tools stay out of the way?',entries:library.hits.slice(0,2).map(hit=>({ref:hit.ref,title:hit.title,source:hit.source,url:hit.url!,excerpt:hit.excerpt,addedAt:at})),livePortals:[],createdAt:at,updatedAt:at};
const desk:CollectionData={collection,unavailableRefs:[],unavailablePortals:[],orientationStale:false,live:[]};
const comparison:ComparisonResult={question:collection.purpose,sources:library.hits.slice(0,2),orientation:{text:'Both sources favor a small number of visible actions. The second emphasizes preserving context while controls change.',refs:library.hits.slice(0,2).map(hit=>hit.ref),createdAt:at}};
const session:CatchupSession={id:'session_design',startedAt:at,stories:library.hits.slice(0,3).map((hit,i)=>({portalId:'design',source:'Design notes',sourceKind:'rss',item:{id:String(i),title:hit.title,url:hit.url!,summary:hit.excerpt,meta:[]},marks:[{portalId:'design',itemId:String(i)}]})),cursor:0,outcomes:[],failures:[]};
const baseWatch={id:'watch_0123456789abcdef01234567',title:'Design notes',timezone:'UTC',paused:false,addedAt:at,nextCheck:at,lastSuccess:at,failures:0,events:[]};
const changes:WatchResult={watches:[{...baseWatch,kind:'page',url:'https://example.com/guide'}],inbox:[{id:'finding_design',watchId:baseWatch.id,kind:'change',title:'Guide updated',url:'https://example.com/guide',at,dedup:'design',read:false,diff:[{kind:'removed',text:'Open the settings panel.'},{kind:'added',text:'Open Settings to choose a layout.'}]}],artistAvailable:false,checkedAt:at,worker:'Checks run periodically while the server is available.'};
const events:WatchResult={...changes,watches:[{...baseWatch,kind:'calendar',url:'https://example.com/calendar.ics',events:[{id:'event_design',title:'Design reading group',url:'https://example.com/event',startsAt:'2099-10-11T18:00:00Z',timezone:'UTC',venue:'Reading room',city:'New York',status:'scheduled',provider:'calendar',updatedAt:at}]}],inbox:[]};
export const experienceViews=['library','collections','desk','compare','catchup','changes','events'];
export function designExperience(view:string):Record<string,unknown>|undefined {
 return ({library:{library},collections:{collections:[collection],sources:[]},desk:{collections:[collection],sources:[],desk},compare:{comparison},catchup:{session},changes:{watches:changes},events:{watches:events}} as Record<string,Record<string,unknown>>)[view];
}
export function designExperienceTool(name:string):Record<string,unknown>|undefined {
 return name==='search_library'?{library}:name==='open_collection'?{collections:[collection],sources:[]}:name==='catch_up'?{session}:name==='watch_reading'?{watches:changes}:undefined;
}
