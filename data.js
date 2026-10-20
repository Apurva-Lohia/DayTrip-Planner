export const places = [
 {id:'central',name:'Central Station',lat:-33.8832,lng:151.2066,kind:'origin'},
 {id:'parramatta',name:'Parramatta Station',lat:-33.8177,lng:151.0055,kind:'origin'},
 {id:'katoomba',name:'Katoomba Station',lat:-33.7126,lng:150.3119,kind:'origin'},
 {id:'sisters',name:'Three Sisters · Echo Point',lat:-33.7321,lng:150.3120,kind:'sight'},
 {id:'falls',name:'Wentworth Falls lookout',lat:-33.7253,lng:150.3693,kind:'sight'},
 {id:'leura',name:'Leura village',lat:-33.7143,lng:150.3310,kind:'sight'},
 {id:'garden',name:'Royal Botanic Garden Sydney',lat:-33.8642,lng:151.2166,kind:'sight'},
 {id:'opera',name:'Sydney Opera House',lat:-33.8568,lng:151.2153,kind:'sight'},
 {id:'bondi',name:'Bondi Beach',lat:-33.8915,lng:151.2767,kind:'sight'},
 {id:'coogee',name:'Coogee Beach',lat:-33.9204,lng:151.2585,kind:'sight'},
 {id:'newtown',name:'Newtown',lat:-33.8981,lng:151.1795,kind:'sight'},
 {id:'cafe-k',name:'Sample café · Katoomba',lat:-33.7151,lng:150.3113,kind:'cafe'},
 {id:'cafe-c',name:'Sample café · Circular Quay',lat:-33.8616,lng:151.2112,kind:'cafe'},
 {id:'lunch-l',name:'Sample lunch stop · Leura',lat:-33.7149,lng:150.3307,kind:'lunch'},
 {id:'lunch-s',name:'Sample lunch stop · Surry Hills',lat:-33.8843,lng:151.2121,kind:'lunch'}
];
export function distance(a,b){const r=Math.PI/180,x=(b.lng-a.lng)*r*Math.cos((a.lat+b.lat)*r/2),y=(b.lat-a.lat)*r;return Math.sqrt(x*x+y*y)*6371;}
export function sydneyTime(date,minutes){
 const base=Date.parse(date+'T00:00:00Z')+minutes*60000;
 const offsetAt=t=>{const p=new Intl.DateTimeFormat('en-AU',{timeZone:'Australia/Sydney',timeZoneName:'shortOffset'}).formatToParts(new Date(t)).find(x=>x.type==='timeZoneName').value;const m=p.match(/GMT([+-])(\d+)(?::(\d+))?/);return m?(m[1]==='-'?-1:1)*(Number(m[2])*60+Number(m[3]||0)):0;};
 let result=base-offsetAt(base)*60000;result=base-offsetAt(result)*60000;return result;
}
export const minute=s=>{if(!/^\d{2}:\d{2}$/.test(s))throw Error('Enter valid times.');const [h,m]=s.split(':').map(Number);if(h>23||m>59)throw Error('Enter valid times.');return h*60+m;};
