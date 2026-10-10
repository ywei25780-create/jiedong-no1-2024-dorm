import {Box3,MathUtils,PerspectiveCamera,Sphere,Vector3} from 'three';
import type {OrbitControls} from 'three/addons/controls/OrbitControls.js';

/** Drop residual rotation/pan before changing modes without moving the view. */
export function clearOrbitMotion(camera:PerspectiveCamera,orbit:OrbitControls){
 const position=camera.position.clone(),rotation=camera.quaternion.clone(),target=orbit.target.clone();
 const damping=orbit.enableDamping;
 orbit.enableDamping=false;orbit.update();orbit.enableDamping=damping;
 camera.position.copy(position);camera.quaternion.copy(rotation);orbit.target.copy(target);
 camera.updateMatrixWorld();
}

/** Fit the full scan, including its height, for the current viewport. */
export function fitOverviewCamera(camera:PerspectiveCamera,bounds:Box3,margin=1.12){
 const sphere=bounds.getBoundingSphere(new Sphere());
 const radius=Math.max(sphere.radius,.1);
 const verticalHalf=MathUtils.degToRad(camera.getEffectiveFOV())/2;
 const horizontalHalf=Math.atan(Math.tan(verticalHalf)*camera.aspect);
 const distance=radius/Math.sin(Math.min(verticalHalf,horizontalHalf))*margin;
 const target=sphere.center.clone();
 camera.position.copy(target).add(new Vector3(0,distance,.001));
 camera.lookAt(target);
 camera.far=Math.max(camera.far,distance+radius*2+camera.near);
 camera.updateProjectionMatrix();camera.updateMatrixWorld();
 return {target,distance,maxDistance:Math.max(35,distance*1.5)};
}
