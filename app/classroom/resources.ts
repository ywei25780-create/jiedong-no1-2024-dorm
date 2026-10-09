import {BufferGeometry,Material,Object3D,Texture} from 'three';
/** Release both GPU resources and GLTFLoader's decoded ImageBitmaps. */
export function disposeObject(root:Object3D){
 const geometries=new Set<BufferGeometry>(),materials=new Set<Material>(),textures=new Set<Texture>(),bitmaps=new Set<{close:()=>void}>();
 root.traverse(object=>{const mesh=object as Object3D&{geometry?:BufferGeometry;material?:Material|Material[]};if(mesh.geometry)geometries.add(mesh.geometry);if(mesh.material)for(const material of Array.isArray(mesh.material)?mesh.material:[mesh.material])materials.add(material)});
 for(const material of materials)for(const value of Object.values(material))if(value instanceof Texture)textures.add(value);
 for(const texture of textures){const data=texture.source.data;for(const item of Array.isArray(data)?data:[data])if(item&&typeof item.close==='function')bitmaps.add(item);texture.dispose()}
 geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());bitmaps.forEach(b=>b.close());root.clear();
}
