// Verified anonymous ArcGIS REST directories; individual layers retain provider terms.
export const publicSources=[
 {id:'copernicus',name:'Copernicus',region:'Global',description:'Sentinel imagery, land cover, atmosphere and environmental data',catalogue:'copernicus',thumbnail:'https://s3.waw3-2.cloudferro.com/swift/v1/stac-png/S2_L2A.jpg',credit:'Copernicus Sentinel imagery'},
 {id:'aws-open-data',name:'AWS Open Data',region:'Global',description:'Earth Search collections and the full AWS Open Data registry',catalogue:'aws',thumbnail:'https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/55/J/BN/2024/8/S2B_55JBN_20240830_0_L2A/thumbnail.jpg',credit:'Sentinel-2 · Earth Search on AWS'},
 {id:'usgs-all',name:'USGS · Data catalogue',region:'United States and global',description:'All National Map services, research datasets, DEM, LiDAR and Landsat',catalogue:'usgs',thumbnail:'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryTopo/MapServer/export?bbox=-112.3,35.9,-111.6,36.4&bboxSR=4326&imageSR=3857&size=600,280&format=jpg&f=image',credit:'USGS National Map'},
 {id:'usgs-earthquakes',name:'USGS · Earthquakes and hazards',region:'United States and global',description:'Earthquake hazards and related map services',root:'https://earthquake.usgs.gov/arcgis/rest/services'},
 {id:'qglobe',name:'QGlobe',region:'Australia',description:'Queensland geology, property, water and infrastructure',root:'https://spatial-gis.information.qld.gov.au/arcgis/rest/services'},
 {id:'wa',name:'Western Australia · SLIP',region:'Australia',description:'Western Australian public spatial services',root:'https://services.slip.wa.gov.au/public/rest/services'},
 {id:'abs',name:'Australian Bureau of Statistics',region:'Australia',description:'Statistical boundaries and census geography',root:'https://geo.abs.gov.au/arcgis/rest/services'},
 {id:'usgs-carto',name:'USGS · National Map',region:'United States',description:'Topography, transport, structures and government boundaries',root:'https://carto.nationalmap.gov/arcgis/rest/services'},
 {id:'usgs-hydro',name:'USGS · Water',region:'United States',description:'National hydrography, waterways and watersheds',root:'https://hydro.nationalmap.gov/arcgis/rest/services'},
 {id:'usgs-basemaps',name:'USGS · Imagery and relief',region:'United States',description:'Topographic, imagery and shaded-relief maps',root:'https://basemap.nationalmap.gov/arcgis/rest/services'},
 {id:'noaa',name:'NOAA · Coastal data',region:'United States',description:'Coasts, elevation, land cover and marine data',root:'https://coast.noaa.gov/arcgis/rest/services'},
 {id:'usfs',name:'US Forest Service',region:'United States',description:'Forests, public lands and natural resources',root:'https://apps.fs.usda.gov/arcx/rest/services'},
 {id:'census',name:'US Census · TIGERweb',region:'United States',description:'Administrative and statistical boundaries',root:'https://tigerweb.geo.census.gov/arcgis/rest/services'}
];
