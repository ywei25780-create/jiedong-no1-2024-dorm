"""Create a web GLB from an OBJ scan. Originals are never modified.
Usage: python scripts/convert-classroom.py INPUT.obj TEXTURE.jpg OUTPUT.glb
Requires numpy, scipy, Pillow. --texture-size 4096 creates a mobile texture copy.
"""
import argparse, hashlib, io, json, struct
from pathlib import Path
import numpy as np
from scipy import ndimage
from PIL import Image

def convert(obj, texture, output, texture_size):
    positions, uvs, faces = [], [], []
    for line in obj.open(encoding='utf-8'):
        parts = line.split()
        if not parts: continue
        if parts[0] == 'v': positions.append([float(v) for v in parts[1:4]])
        elif parts[0] == 'vt': uvs.append([float(v) for v in parts[1:3]])
        elif parts[0] == 'f':
            poly = [[int(v) - 1 for v in corner.split('/')[:2]] for corner in parts[1:]]
            for i in range(1, len(poly) - 1): faces.extend([poly[0], poly[i], poly[i+1]])
    raw = np.array(positions, dtype='<f4'); uv = np.array(uvs, dtype='<f4')
    keys, indices = np.unique(np.array(faces, dtype=np.int32), axis=0, return_inverse=True)
    pos = raw[keys[:,0]]; tex = uv[keys[:,1]].copy(); tex[:,1] = 1 - tex[:,1]
    indices = indices.astype('<u4'); tri = pos[indices.reshape(-1,3)]
    cross = np.cross(tri[:,1]-tri[:,0],tri[:,2]-tri[:,0]); normals=np.zeros_like(pos)
    for j in range(3): np.add.at(normals,indices.reshape(-1,3)[:,j],cross)
    normals /= np.maximum(np.linalg.norm(normals,axis=1,keepdims=True),1e-10)
    jpeg = texture.read_bytes()
    Image.MAX_IMAGE_PIXELS = None
    im = Image.open(io.BytesIO(jpeg)); original_size=im.size
    if texture_size and max(im.size)>texture_size:
        im.thumbnail((texture_size,texture_size),Image.Resampling.LANCZOS)
        buff=io.BytesIO();im.save(buff,format='JPEG',quality=94,subsampling=0);jpeg=buff.getvalue()
    binary=bytearray(); views=[]
    def add(data,target=None):
        while len(binary)%4: binary.append(0)
        v={'buffer':0,'byteOffset':len(binary),'byteLength':len(data)}
        if target: v['target']=target
        views.append(v);binary.extend(data);return len(views)-1
    pi=add(pos.tobytes(),34962);ni=add(normals.tobytes(),34962);ui=add(tex.tobytes(),34962);ii=add(indices.tobytes(),34963);ji=add(jpeg)
    d={'asset':{'version':'2.0','generator':'Classroom scan format conversion'},'scene':0,'scenes':[{'nodes':[0]}],'nodes':[{'mesh':0,'name':'真实高二教室扫描'}],
       'meshes':[{'primitives':[{'attributes':{'POSITION':0,'NORMAL':1,'TEXCOORD_0':2},'indices':3,'material':0}]}],
       'accessors':[{'bufferView':pi,'componentType':5126,'count':len(pos),'type':'VEC3','min':pos.min(axis=0).tolist(),'max':pos.max(axis=0).tolist()},
                    {'bufferView':ni,'componentType':5126,'count':len(pos),'type':'VEC3'}, {'bufferView':ui,'componentType':5126,'count':len(tex),'type':'VEC2'},
                    {'bufferView':ii,'componentType':5125,'count':len(indices),'type':'SCALAR'}],
       'materials':[{'name':'原扫描颜色','doubleSided':True,'pbrMetallicRoughness':{'baseColorTexture':{'index':0},'metallicFactor':0,'roughnessFactor':1},'extensions':{'KHR_materials_unlit':{}}}],
       'extensionsUsed':['KHR_materials_unlit'],'textures':[{'source':0,'sampler':0}],'samplers':[{'magFilter':9729,'minFilter':9987,'wrapS':33071,'wrapT':33071}],
       'images':[{'bufferView':ji,'mimeType':'image/jpeg'}],'buffers':[{'byteLength':len(binary)}],'bufferViews':views}
    encoded=json.dumps(d,ensure_ascii=False,separators=(',',':')).encode();encoded+=b' '*((-len(encoded))%4);binary+=b'\0'*((-len(binary))%4)
    glb=struct.pack('<4sII',b'glTF',2,28+len(encoded)+len(binary))+struct.pack('<II',len(encoded),0x4e4f534a)+encoded+struct.pack('<II',len(binary),0x004e4942)+binary
    output.parent.mkdir(parents=True,exist_ok=True);output.write_bytes(glb)
    # Dominant low horizontal surface, weighted by triangle area, determines floor.
    area=np.linalg.norm(cross,axis=1)/2; horizontal=np.abs(cross[:,1])>np.linalg.norm(cross,axis=1)*.93
    yc=tri[:,:,1].mean(axis=1); low=horizontal&(yc<np.percentile(raw[:,1],35))
    hist,edges=np.histogram(yc[low],bins=np.arange(raw[:,1].min(),raw[:,1].max()+.025,.025),weights=area[low]); floor=float((edges[hist.argmax()]+edges[hist.argmax()+1])/2)
    xmin,zmin=raw[:,[0,2]].min(axis=0);xmax,zmax=raw[:,[0,2]].max(axis=0);res=.06;w=int(np.ceil((xmax-xmin)/res))+1;h=int(np.ceil((zmax-zmin)/res))+1
    samples=np.concatenate([tri[:,0],tri[:,1],tri[:,2],tri.mean(axis=1)])
    def grid(mask):
        cells=np.zeros((h,w),dtype=bool);v=samples[mask];ix=((v[:,0]-xmin)/res).astype(int);iz=((v[:,2]-zmin)/res).astype(int);cells[iz,ix]=True;return cells
    ground=grid(np.abs(samples[:,1]-floor)<.15);ground=ndimage.binary_closing(ground,iterations=4);ground=ndimage.binary_fill_holes(ground)
    # Table/chair volumes near desk height define simplified colliders; sparse
    # isolated scan samples are ignored for navigation only, never removed from GLB.
    occupied=grid((samples[:,1]>floor+.5)&(samples[:,1]<floor+.95));radius=.16
    obstacle_labels,_=ndimage.label(occupied);obstacle_sizes=np.bincount(obstacle_labels.ravel());obstacle_sizes[0]=0
    occupied=obstacle_sizes[obstacle_labels]>15
    walk=ground&(ndimage.distance_transform_edt(~occupied)*res>radius);labels,n=ndimage.label(walk);sizes=np.bincount(labels.ravel());sizes[0]=0
    if n: walk=labels==int(sizes.argmax())
    dist=ndimage.distance_transform_edt(walk)*res;gz,gx=np.indices(walk.shape);cx=(xmin+xmax)/2;cz=(zmin+zmax)/2
    score=dist-.4*np.hypot(xmin+(gx+.5)*res-cx,zmin+(gz+.5)*res-cz);score[~walk]=-100
    iz,ix=np.unravel_index(score.argmax(),dist.shape);spawn=[float(xmin+(ix+.5)*res),floor+1.65,float(zmin+(iz+.5)*res)]
    nav={'x0':float(xmin),'z0':float(zmin),'resolution':res,'width':w,'height':h,'floorY':floor,'radius':radius,'cells':walk.astype(int).ravel().tolist(),'spawn':spawn}
    output.with_suffix('.navigation.json').write_text(json.dumps(nav,separators=(',',':')),encoding='utf-8')
    report={'sourceVertices':len(raw),'webVertices':len(pos),'triangles':len(indices)//3,'bounds':{'min':raw.min(axis=0).tolist(),'max':raw.max(axis=0).tolist()},'floorY':floor,'spawn':spawn,'walkableCells':int(walk.sum()),'originalTexture':original_size,'runtimeTexture':im.size,'textureBytes':len(jpeg),'glbBytes':len(glb),'sha256':hashlib.sha256(glb).hexdigest(),'geometryChanged':False,'textureResized':im.size!=original_size}
    output.with_suffix('.report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps(report,ensure_ascii=False))

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('obj',type=Path);p.add_argument('texture',type=Path);p.add_argument('output',type=Path);p.add_argument('--texture-size',type=int,default=0);a=p.parse_args();convert(a.obj,a.texture,a.output,a.texture_size)
