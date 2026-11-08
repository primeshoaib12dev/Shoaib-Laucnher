import base64,re,io
from PIL import Image
root='/home/claude/shoaib-launcher/'
css=open(root+'src/renderer/style.css').read()
app=open(root+'src/renderer/app.js').read()
stub=open(root+'preview/stub.js').read()
html=open(root+'src/renderer/index.html').read()
def uri(path,size=None):
    im=Image.open(path)
    if size: im=im.resize(size)
    b=io.BytesIO(); im.save(b,'PNG',optimize=True); return 'data:image/png;base64,'+base64.b64encode(b.getvalue()).decode()
icon=uri(root+'src/assets/icon.png',(96,96)); bg=uri(root+'src/assets/bg.png')
css=css.replace('url("../assets/bg.png")','url('+bg+')')
css=css.replace('html{font-size:calc(10px + .5vh)}','html{font-size:calc(min(100vw,177.78vh)/94)}')
css=css.replace('html,body{margin:0;height:100%;background:#000;','html,body{margin:0;height:100%;background:#000;')
extra='''
#frame{position:relative;width:min(100vw,177.78vh);height:min(56.25vw,100vh);margin:auto;display:flex;flex-direction:column;overflow:hidden;background:#000;transform:translateZ(0)}
body{align-items:center;justify-content:center}
@media (orientation:portrait){html{font-size:calc(100vh/94)}#frame{position:fixed;top:0;left:0;width:100vh;height:100vw;margin:0;transform-origin:top left;transform:translateX(100vw) rotate(90deg)}}
#toasts,#modal-root .overlay,#dl-status{position:absolute}
'''
html=re.sub(r'<meta http-equiv="Content-Security-Policy"[^>]*>','<meta name="color-scheme" content="dark">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',html)
html=html.replace('<link rel="stylesheet" href="style.css">','<style>'+css+extra+'</style>')
html=html.replace('<body>','<body>\n<div id="frame">',1)
html=html.replace('<script src="web-bridge.js"></script>\n','')
html=html.replace('<script src="app.js"></script>','</div>\n<script>'+stub+'</script>\n<script>'+app+'</script>')
html=html.replace('Shoaib Launcher V1 &nbsp;•&nbsp; Mod By Shoaib','PREVIEW with demo data &nbsp;•&nbsp; Shoaib Launcher V1 &nbsp;•&nbsp; Mod By Shoaib')
html=html.replace('../assets/icon.png',icon)
open('/mnt/user-data/outputs/shoaib-launcher-preview.html','w').write(html)
print(len(html)//1024,'KB')
