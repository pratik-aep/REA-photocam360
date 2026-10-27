/**
 * Self-contained 360° viewer page: a full-screen WebGL shader that samples the equirectangular
 * image per pixel. No network or libraries needed. Drag to look, pinch (or wheel) to zoom.
 * Renders only when the view changes.
 */
export const viewerHtml = (imageSrc: string) => `<!doctype html><html><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no">
<style>html,body{margin:0;height:100%;overflow:hidden;background:#000;touch-action:none}canvas{width:100%;height:100%;display:block}
#msg{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;color:#fff;font:16px sans-serif}</style>
</head><body><canvas id="c"></canvas><div id="msg">Loading…</div><script>
(function(){
var post=function(m){try{window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(JSON.stringify(m))}catch(e){}};
var msg=document.getElementById('msg'),c=document.getElementById('c');
var fail=function(t){msg.textContent=t;post({type:'error',message:t})};
var gl=c.getContext('webgl')||c.getContext('experimental-webgl');
if(!gl){fail('WebGL is not available');return}
function sh(type,src){var s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);
if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(s));return s}
var view={yaw:0,pitch:0,fov:75},ready=false,queued=false,loaded=null,U={};
// Builds every GL resource for the current context. Runs on load and again after a context
// loss (Android drops a backgrounded WebView's GL context), when all of them are gone.
function setup(){
var prog=gl.createProgram();
gl.attachShader(prog,sh(gl.VERTEX_SHADER,'attribute vec2 p;varying vec2 v;void main(){v=p;gl_Position=vec4(p,0.,1.);}'));
gl.attachShader(prog,sh(gl.FRAGMENT_SHADER,[
'precision highp float;varying vec2 v;uniform sampler2D t;uniform float yaw,pitch,tanHalf,aspect;',
'void main(){vec3 d=normalize(vec3(v.x*tanHalf*aspect,v.y*tanHalf,1.));',
'float cp=cos(pitch),sp=sin(pitch);d=vec3(d.x,d.y*cp+d.z*sp,-d.y*sp+d.z*cp);',
'float cy=cos(yaw),sy=sin(yaw);d=vec3(d.x*cy+d.z*sy,d.y,-d.x*sy+d.z*cy);',
'float lon=atan(d.x,d.z),lat=asin(clamp(d.y,-1.,1.));',
'gl_FragColor=texture2D(t,vec2(lon/6.28318530718+.5,.5-lat/3.14159265359));}'].join('')));
gl.linkProgram(prog);gl.useProgram(prog);
var buf=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buf);
gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);
var loc=gl.getAttribLocation(prog,'p');gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,2,gl.FLOAT,false,0,0);
['yaw','pitch','tanHalf','aspect'].forEach(function(n){U[n]=gl.getUniformLocation(prog,n)});
var src=loaded,max=gl.getParameter(gl.MAX_TEXTURE_SIZE);
if(src.width>max||src.height>max){var s=Math.min(max/src.width,max/src.height),cv=document.createElement('canvas');
cv.width=Math.floor(src.width*s);cv.height=Math.floor(src.height*s);cv.getContext('2d').drawImage(src,0,0,cv.width,cv.height);src=cv}
var pot=function(n){return(n&(n-1))===0};var wrap=pot(src.width)&&pot(src.height)?gl.REPEAT:gl.CLAMP_TO_EDGE;
var tex=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,tex);
gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,wrap);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
gl.texImage2D(gl.TEXTURE_2D,0,gl.RGB,gl.RGB,gl.UNSIGNED_BYTE,src);
ready=true}
c.addEventListener('webglcontextlost',function(e){e.preventDefault();ready=false});
c.addEventListener('webglcontextrestored',function(){if(loaded){try{setup();redraw()}catch(e){fail('Could not restore the viewer')}}});
function draw(){queued=false;if(!ready)return;var dpr=Math.min(window.devicePixelRatio||1,2);
var w=Math.round(c.clientWidth*dpr),h=Math.round(c.clientHeight*dpr);if(c.width!==w||c.height!==h){c.width=w;c.height=h}
gl.viewport(0,0,w,h);gl.uniform1f(U.yaw,view.yaw);gl.uniform1f(U.pitch,view.pitch);
gl.uniform1f(U.tanHalf,Math.tan(view.fov*Math.PI/360));gl.uniform1f(U.aspect,w/h);gl.drawArrays(gl.TRIANGLE_STRIP,0,4)}
function redraw(){if(!queued){queued=true;requestAnimationFrame(draw)}}
window.__view=view;window.__redraw=redraw;
var img=new Image();
img.onload=function(){loaded=img;
try{setup()}catch(e){fail('Could not start the viewer');return}
msg.style.display='none';redraw();post({type:'loaded',width:img.width,height:img.height})};
img.onerror=function(){fail('Could not load the panorama')};
img.src=${JSON.stringify(imageSrc).replace(/</g, '\\u003c')};
var pts={},last=null;
function state(){var k=Object.keys(pts);if(k.length===1){var p=pts[k[0]];return{x:p.x,y:p.y}}
if(k.length>=2){var a=pts[k[0]],b=pts[k[1]];return{x:(a.x+b.x)/2,y:(a.y+b.y)/2,d:Math.hypot(a.x-b.x,a.y-b.y)}}return null}
c.addEventListener('pointerdown',function(e){c.setPointerCapture(e.pointerId);pts[e.pointerId]={x:e.clientX,y:e.clientY};last=state()});
c.addEventListener('pointermove',function(e){if(!pts[e.pointerId])return;pts[e.pointerId]={x:e.clientX,y:e.clientY};var s=state();
if(last&&s){var k=view.fov/c.clientHeight*Math.PI/180;view.yaw-=(s.x-last.x)*k;view.pitch+=(s.y-last.y)*k;
if(s.d&&last.d)view.fov=Math.max(30,Math.min(100,view.fov*last.d/s.d));
view.pitch=Math.max(-Math.PI/2,Math.min(Math.PI/2,view.pitch));redraw()}last=s});
var up=function(e){delete pts[e.pointerId];last=state()};
c.addEventListener('pointerup',up);c.addEventListener('pointercancel',up);
c.addEventListener('wheel',function(e){e.preventDefault();view.fov=Math.max(30,Math.min(100,view.fov*Math.exp(e.deltaY*.001)));redraw()},{passive:false});
window.addEventListener('resize',redraw);
})();
</script></body></html>`;
