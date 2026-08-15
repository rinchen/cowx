/** Re-export NWS zone geometry helpers from the public client module. */
export {
  _clearZoneGeometryCacheForTests,
  collectColoradoZoneRefs,
  geometryForAlertFeature,
  hydrateAlertGeometries,
  loadZoneGeometry,
  mergeZoneGeometries,
  ugcToZoneRef,
} from '../../public/js/nws-zone-geometry.js';
