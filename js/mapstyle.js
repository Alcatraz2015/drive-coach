/* Drive Coach: night map style. Takes OpenFreeMap's "liberty" style and recolours it for driving at night:
   dark slate (not black) ground, clearly visible grey streets, warm amber main roads and highways, blue water, readable labels.
   Pure function, so it can be tested in Node. */
(function(root){
const N={
  ground:'#1E2731', residential:'#222C37', green:'#1F3328', special:'#25303C', sand:'#2A3138', ice:'#2B3540',
  water:'#163A57', waterLine:'#1F5076', building:'#2B3540', buildingEdge:'#35424F', aeroway:'#29333E',
  casing:'#11171D', minor:'#56626F', service:'#46515D', path:'#3C4854', link:'#8F7E59',
  secondary:'#8F7E59', primary:'#B08C4C', motorway:'#D29440', rail:'#4B525B', boundary:'#5D6977',
  label:'#DCE3EA', labelSoft:'#A7B3BF', labelHalo:'#1E2731', waterLabel:'#86AED3', poi:'#A7B3BF'
};
function roadColor(id){
  if(/rail/.test(id))return N.rail;
  if(/path_pedestrian/.test(id))return N.path;
  if(/motorway/.test(id))return N.motorway;
  if(/trunk_primary/.test(id))return N.primary;
  if(/secondary_tertiary/.test(id))return N.secondary;
  if(/_link/.test(id))return N.link;
  if(/service_track/.test(id))return N.service;
  if(/minor|street/.test(id))return N.minor;
  return N.minor}
function nightStyle(style){
  const s=JSON.parse(JSON.stringify(style));s.name='Drive Coach night';
  s.layers=s.layers.filter(l=>l.id!=='building-3d');
  for(const l of s.layers){const id=l.id,p=l.paint=l.paint||{},t=l.type;
    if(t==='background'){p['background-color']=N.ground;continue}
    if(t==='raster'){p['raster-brightness-max']=0.35;p['raster-saturation']=-0.4;continue}
    if(t==='fill'){
      if(id==='water')p['fill-color']=N.water;
      else if(id==='building'){p['fill-color']=N.building;p['fill-outline-color']=N.buildingEdge}
      else if(/park|wood|grass|wetland/.test(id)){p['fill-color']=N.green;delete p['fill-outline-color'];if(p['fill-opacity']==null)p['fill-opacity']=1}
      else if(id==='landuse_residential')p['fill-color']=N.residential;
      else if(/sand/.test(id))p['fill-color']=N.sand;
      else if(/ice/.test(id))p['fill-color']=N.ice;
      else if(/aeroway/.test(id))p['fill-color']=N.aeroway;
      else if(/road_area_pattern/.test(id))p['fill-opacity']=0.15;
      else p['fill-color']=N.special;
      continue}
    if(t==='line'){
      if(/^waterway/.test(id))p['line-color']=N.waterLine;
      else if(/park_outline/.test(id))p['line-color']=N.green;
      else if(/boundary/.test(id))p['line-color']=N.boundary;
      else if(/aeroway/.test(id))p['line-color']=N.aeroway;
      else if(/_casing$/.test(id))p['line-color']=N.casing;
      else if(l['source-layer']==='transportation'){p['line-color']=roadColor(id);if(/^tunnel/.test(id))p['line-opacity']=0.6}
      continue}
    if(t==='symbol'){
      if(p['text-color']!=null||l.layout&&l.layout['text-field']){
        p['text-color']=/water/.test(id)?N.waterLabel:/^poi|airport/.test(id)?N.poi:/highway-name/.test(id)?N.label:/label_(other|state)/.test(id)?N.labelSoft:N.label;
        p['text-halo-color']=N.labelHalo;if(p['text-halo-width']==null)p['text-halo-width']=1.2}
      if(/^poi/.test(id)&&p['icon-opacity']==null)p['icon-opacity']=0.75}
  }
  return s}
const API={nightStyle,NIGHT:N};
if(typeof module!=='undefined')module.exports=API;else Object.assign(root,API);
})(typeof window!=='undefined'?window:globalThis);
