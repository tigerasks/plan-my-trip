# Service test results

Raw output from `docs/probe.html`, run by the owner against the published page. The design doc's
"Service test" section summarises what each run showed; this file keeps the numbers behind it.

Runs 1 and 2 (Fri 25 Sep 2026) were not kept as blocks — only their summary in the design doc.

## Run 4 — Wed 21 Oct 2026, 14:41 UTC · the public transport probe

`docs/probe-transit.html`, Chrome 155 on macOS. Two journeys: one only a bus could do
(Daisen-in → Kinkaku-ji) and one a train can (Tō-ji → Kyoto Station).

**Read the Overpass counts with care.** The probe asked for `out tags 60`, and every one of the four
ends came back with stops + routes summing to exactly 60, so all of them are truncated. In
particular the "0 route relations" at Kyoto Station is an artefact of 60 bus stops filling the
answer, not a fact about the map. The limit was raised to 400 afterwards. Everything else in the
block stands.

```json
{
 "probe": "day-planner transit probe 2",
 "ranAt": "2026-10-21T14:41:53.140Z",
 "page": {
  "origin": "https://tigerasks.github.io",
  "secureContext": true,
  "browser": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36"
 },
 "runs": [
  {
   "from": { "name": "Daisen-in", "at": [35.04452, 135.74581], "how": "search" },
   "to": { "name": "Kinkaku-ji", "at": [35.03953, 135.72954], "how": "search" },
   "journey": {
    "ok": true, "ms": 293, "time": "2026-10-22T08:00:00.000Z",
    "itineraries": 0, "withTransit": 0, "direct": 1, "modes": [],
    "bestLegs": null, "bestMinutes": null
   },
   "stops": [
    { "ok": true, "path": "/api/v1/reverse-geocode", "ms": 50, "end": "A", "shape": "array",
      "count": 0, "stops": [], "anythingCount": 10,
      "anything": [
       { "name": "玄関", "type": "PLACE", "id": "way/[975153610]" },
       { "name": "Daisen-in Zen Garden", "type": "PLACE", "id": "node/[5110367297]" },
       { "name": "史跡 及 名勝 大仙院庭園", "type": "PLACE", "id": "node/[9024263049]" },
       { "name": "大仙院", "type": "PLACE", "id": "node/[9024263058]" },
       { "name": "大仙院", "type": "PLACE", "id": "way/[972811494]" },
       { "name": "史跡 及 名勝 真珠庵庭園", "type": "PLACE", "id": "node/[9024263108]" },
       { "name": "真珠庵", "type": "PLACE", "id": "way/[972811495]" },
       { "name": "宗務本所", "type": "PLACE", "id": "way/[963345099]" }
      ],
      "anyTypes": ["PLACE"] },
    { "ok": true, "path": "/api/v1/reverse-geocode", "ms": 43, "end": "B", "shape": "array",
      "count": 0, "stops": [], "anythingCount": 10,
      "anything": [
       { "name": "金閣寺町", "type": "PLACE", "id": "node/[9247484447]" },
       { "name": "庫裡", "type": "PLACE", "id": "way/[345464005]" },
       { "name": "書院", "type": "PLACE", "id": "way/[345464009]" },
       { "name": "方丈", "type": "PLACE", "id": "way/[188772157]" },
       { "name": "唐門", "type": "PLACE", "id": "way/[347012938]" },
       { "name": "布袋石", "type": "PLACE", "id": "node/[3537674658]" },
       { "name": "女龍石", "type": "PLACE", "id": "node/[3537674657]" },
       { "name": "相馬石", "type": "PLACE", "id": "node/[3537674659]" }
      ],
      "anyTypes": ["PLACE"] }
   ],
   "map": [
    { "ok": true, "ms": 29541, "end": "A", "within": "800 m", "busStops": 38,
      "stopNames": ["Murasakino Sendocho", "Murasakino Sendocho", "Murasakino Sendocho",
                    "Jotokuji-mae", "Senbon Kitaoji", "Daitokuji-mae"],
      "routeRelations": 22, "routesWithRef": 22,
      "routes": [
       { "ref": "102", "name": "Bus 102: 北大路バスターミナル => 錦林車庫前", "kind": "bus", "operator": "京都市交通局" },
       { "ref": "102", "name": "Bus 102: 錦林車庫前 => 北大路バスターミナル", "kind": "bus", "operator": "京都市交通局" },
       { "ref": "6", "name": "", "kind": "bus", "operator": "京都市交通局" },
       { "ref": "6", "name": "", "kind": "bus", "operator": "京都市交通局" },
       { "ref": "9", "name": "", "kind": "bus", "operator": "京都市交通局" },
       { "ref": "12", "name": "", "kind": "bus", "operator": "京都市交通局" },
       { "ref": "12", "name": "", "kind": "bus", "operator": "京都市交通局" },
       { "ref": "37", "name": "Bus 37: 三条京阪前 => 西賀茂車庫前", "kind": "bus", "operator": "京都市交通局" }
      ] },
    { "ok": true, "ms": 43759, "end": "B", "within": "800 m", "busStops": 20,
      "stopNames": ["Ritsumeikan Daigaku-mae (Ritsumeikan Univ.)", "Waratenjin-mae", "Waratenjin-mae",
                    "Ritsumeikan Daigaku-mae (Ritsumeikan Univ.)", "Kinkakuji-michi (Kinkakuji Temple)", "Senbon Kitaoji"],
      "routeRelations": 40, "routesWithRef": 40,
      "routes": [
       { "ref": "102", "name": "Bus 102: 北大路バスターミナル => 錦林車庫前", "kind": "bus", "operator": "京都市交通局" },
       { "ref": "102", "name": "Bus 102: 錦林車庫前 => 北大路バスターミナル", "kind": "bus", "operator": "京都市交通局" },
       { "ref": "12", "name": "", "kind": "bus", "operator": "京都市交通局" },
       { "ref": "12", "name": "", "kind": "bus", "operator": "京都市交通局" },
       { "ref": "15", "name": "", "kind": "bus", "operator": "京都市交通局" },
       { "ref": "15", "name": "", "kind": "bus", "operator": "京都市交通局" },
       { "ref": "50", "name": "Bus 50: 立命館大学前 => 京都駅前", "kind": "bus", "operator": "京都市交通局" },
       { "ref": "50", "name": "Bus 50: 京都駅前 => 立命館大学前", "kind": "bus", "operator": "京都市交通局" }
      ] }
   ]
  },
  {
   "from": { "name": "To-ji Temple", "at": [34.98063, 135.74772], "how": "search" },
   "to": { "name": "京都駅ビル東第１駐車場 (Kyoto Station Building East First Parkinglot)", "at": [34.98593, 135.76087], "how": "search" },
   "journey": {
    "ok": true, "ms": 161, "time": "2026-10-22T08:00:00.000Z",
    "itineraries": 5, "withTransit": 5, "direct": 1,
    "modes": ["WALK", "REGIONAL_RAIL"],
    "bestLegs": [
     { "mode": "WALK", "duration": 780, "distance": 805, "fromStop": "START", "toStop": "東寺",
       "legGeometry": { "length": 80, "chars": 224 },
       "keysSent": ["mode","from","to","duration","startTime","endTime","scheduledStartTime","scheduledEndTime","realTime","scheduled","distance","legGeometry","steps"] },
     { "mode": "REGIONAL_RAIL", "duration": 120,
       "routeShortName": "8999421", "displayName": "8999421", "headsign": "京都",
       "agencyName": "近畿日本鉄道", "routeType": 106,
       "tripId": "20261022_16:07_jp-japan-rail_8999421", "routeId": "jp-japan-rail_8999421",
       "fromStop": "東寺", "toStop": "京都",
       "legGeometry": { "length": 39, "chars": 157 },
       "keysSent": ["mode","from","to","duration","startTime","endTime","scheduledStartTime","scheduledEndTime","realTime","scheduled","interlineWithPreviousLeg","headsign","tripFrom","tripTo","routeId","routeUrl","directionId","routeType","agencyName","agencyUrl","agencyFareUrl","agencyId","tripId","routeShortName","routeLongName","tripShortName","displayName","cancelled","source","intermediateStops","legGeometry","bikesAllowed","wheelchairAccessible","reservation","alternatives"] },
     { "mode": "WALK", "duration": 540, "distance": 592, "fromStop": "京都", "toStop": "END",
       "legGeometry": { "length": 63, "chars": 176 },
       "keysSent": ["mode","from","to","duration","startTime","endTime","scheduledStartTime","scheduledEndTime","realTime","scheduled","distance","legGeometry","steps"] }
    ],
    "bestMinutes": 24
   },
   "stops": [
    { "ok": true, "path": "/api/v1/reverse-geocode", "ms": 64, "end": "A", "shape": "array",
      "count": 1, "stops": [{ "name": "東寺", "type": "STOP", "id": "jp-japan-rail_9639" }],
      "anythingCount": 10, "anyTypes": ["PLACE"] },
    { "ok": true, "path": "/api/v1/reverse-geocode", "ms": 56, "end": "B", "shape": "array",
      "count": 3,
      "stops": [
       { "name": "京都駅八条口", "type": "STOP", "id": "jp-kochi-seinan-kotsu-Seinan-Expressbus_" },
       { "name": "京都", "type": "STOP", "id": "jp-japan-rail_2784" },
       { "name": "京都駅", "type": "STOP", "id": "jp-Limon-Bus_1002_02" }
      ],
      "anythingCount": 10, "anyTypes": ["PLACE"] }
   ],
   "map": [
    { "ok": true, "ms": 37079, "end": "A", "within": "800 m", "busStops": 41,
      "stopNames": ["Hachijo Aburanokoji", "Kujo Kintetsu-mae", "Kujo Kintetsu-mae",
                    "Minamiku Sogochosha-mae (Minami Ward Office)", "Shimin Bosai Center-mae (Kyoto City Disaster Preve", "Rajomon"],
      "routeRelations": 19, "routesWithRef": 3,
      "routes": [
       { "ref": "サンダーバード", "name": "Thunderbird: Osaka -> Tsuruga", "kind": "train", "operator": "西日本旅客鉄道" },
       { "ref": null, "name": "Limited Express Haruka (Kyoto => Kansai Airport)", "kind": "train", "operator": "西日本旅客鉄道" },
       { "ref": null, "name": "Nozomi", "kind": "train", "operator": "東海旅客鉄道株式会社" },
       { "ref": null, "name": "Kodama (Shin-Osaka => Tokyo)", "kind": "train", "operator": "東海旅客鉄道" },
       { "ref": null, "name": "Kodama (Tokyo => Shin-Osaka)", "kind": "train", "operator": "東海旅客鉄道" },
       { "ref": null, "name": "Nozomi (Hakata => Tokyo)", "kind": "train", "operator": "東海旅客鉄道株式会社" },
       { "ref": null, "name": "Nozomi (Tokyo => Hakata)", "kind": "train", "operator": "東海旅客鉄道株式会社" }
      ] },
    { "ok": true, "ms": 26359, "end": "B", "within": "800 m", "busStops": 60,
      "stopNames": ["Karasuma Nanajo", "Shiokoji Takakura / Kyoto Shiritsu Geijutsudaigaku",
                    "Karasuma Nanajo", "Karasuma Rokujo", "京都駅八条口", "Kyoto Sta. (Hachijoguchi)"],
      "routeRelations": 0, "routesWithRef": 0, "routes": [] }
   ]
  }
 ]
}
```

## Run 3 — Fri 25 Sep 2026, 15:27 UTC

GitHub Pages, Chrome 154 on macOS, around Kyoto Station and Tō-ji.

```json
{
 "probe": "day-planner service test 2",
 "ranAt": "2026-09-25T15:27:17.030Z",
 "page": {
  "protocol": "https:",
  "origin": "https://tigerasks.github.io",
  "secureContext": true,
  "localStorage": true,
  "clipboardApi": true,
  "browser": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36",
  "githubPages": true
 },
 "map": {
  "styles": {
   "liberty": {
    "styleLoaded": true,
    "styleMs": 41,
    "idle": true,
    "tilesLoaded": true
   }
  },
  "library": "loaded"
 },
 "area": {
  "ok": true,
  "found": true,
  "query": "Kyoto",
  "ms": 1547,
  "name": "Kyoto",
  "country": "Japan",
  "type": "railway=station",
  "lat": 34.98461,
  "lng": 135.75843,
  "fields": [
   "osm_type",
   "osm_id",
   "osm_key",
   "osm_value",
   "type",
   "name",
   "street",
   "locality",
   "district",
   "city",
   "state",
   "country",
   "postcode",
   "countrycode"
  ]
 },
 "taps": [
  {
   "style": "liberty",
   "at": [
    34.98428,
    135.76364
   ],
   "featuresHere": 2,
   "sourceLayers": [
    "poi",
    "building"
   ],
   "sourceLayer": "poi",
   "layer": "poi_r7",
   "featureId": "133217066011",
   "properties": {
    "name:ru": "Лучшая бургерная в Киото",
    "name_int": "Wagyu to Worldwide Kyoto Station",
    "name_de": "Wagyu to Worldwide Kyoto Station",
    "name": "Wagyu to Worldwide Kyoto Station",
    "subclass": "fast_food",
    "rank": 18,
    "class": "fast_food",
    "name:latin": "Wagyu to Worldwide Kyoto Station",
    "name_en": "Wagyu to Worldwide Kyoto Station"
   }
  },
  {
   "style": "liberty",
   "at": [
    34.98469,
    135.76743
   ],
   "featuresHere": 2,
   "sourceLayers": [
    "poi",
    "landcover"
   ],
   "sourceLayer": "poi",
   "layer": "poi_r1",
   "featureId": "55023134241",
   "properties": {
    "name_int": "Best Breakfast Point",
    "name_de": "Best Breakfast Point",
    "name": "Best Breakfast Point",
    "subclass": "viewpoint",
    "rank": 5,
    "class": "attraction",
    "name:latin": "Best Breakfast Point",
    "name_en": "Best Breakfast Point"
   }
  },
  {
   "style": "liberty",
   "at": [
    34.98359,
    135.76737
   ],
   "featuresHere": 1,
   "sourceLayers": [
    "poi"
   ],
   "sourceLayer": "poi",
   "layer": "poi_r20",
   "featureId": "138076598781",
   "properties": {
    "name_int": "Wasachi",
    "name_de": "Wasachi",
    "name": "Wasachi",
    "subclass": "cafe",
    "rank": 39,
    "class": "cafe",
    "name:latin": "Wasachi",
    "name_en": "Wasachi"
   }
  },
  {
   "style": "liberty",
   "at": [
    34.98146,
    135.76707
   ],
   "featuresHere": 2,
   "sourceLayers": [
    "poi",
    "building"
   ],
   "sourceLayer": "poi",
   "layer": "poi_r20",
   "featureId": "131242669531",
   "properties": {
    "name_int": "Odashi",
    "name_de": "Odashi",
    "name": "Odashi",
    "subclass": "restaurant",
    "rank": 36,
    "class": "restaurant",
    "name:latin": "Odashi",
    "name_en": "Odashi"
   }
  },
  {
   "style": "liberty",
   "at": [
    34.97887,
    135.75938
   ],
   "featuresHere": 2,
   "sourceLayers": [
    "poi",
    "building"
   ],
   "sourceLayer": "poi",
   "layer": "poi_r20",
   "featureId": "52797288601",
   "properties": {
    "name_int": "Pizza Little Party",
    "name:nonlatin": "ピザリトルパーティ",
    "name_de": "ピザリトルパーティ",
    "name": "ピザリトルパーティ",
    "subclass": "fast_food",
    "rank": 29,
    "name:en": "Pizza Little Party",
    "class": "fast_food",
    "name:latin": "Pizza Little Party",
    "name_en": "Pizza Little Party"
   }
  },
  {
   "style": "liberty",
   "at": [
    34.98061,
    135.74771
   ],
   "featuresHere": 2,
   "sourceLayers": [
    "poi",
    "landcover"
   ],
   "sourceLayer": "poi",
   "layer": "poi_r20",
   "featureId": "3598968102",
   "properties": {
    "name_int": "East Temple",
    "name:nonlatin": "東寺",
    "name:id": "Tō-ji",
    "name:ja-Latn": "Tō-ji",
    "name:sl": "To-dži",
    "name:ja-Hira": "とうじ",
    "name:ca": "Tō-ji",
    "name:ko": "도지",
    "name:el": "Τό-τζι",
    "name_de": "東寺",
    "name:it": "Tō-ji",
    "rank": 23,
    "name:en": "East Temple",
    "class": "place_of_worship",
    "name:cs": "Tódži",
    "name:eu": "Tō-ji"
   }
  }
 ],
 "details": {
  "name": "Pizza Little Party",
  "featureId": "52797288601",
  "decodedAs": "node/5279728860",
  "byId": {
   "ms": 1911,
   "found": true,
   "nameMatches": true
  },
  "method": "id",
  "found": true,
  "osm": "node/5279728860",
  "tagCount": 7,
  "useful": {
   "cuisine": "pizza",
   "phone": "075-672-9889",
   "takeaway": "only"
  }
 },
 "gmaps": {
  "opened": true,
  "query": "ピザリトルパーティ Kyoto",
  "size": [
   560,
   1325
  ]
 },
 "search": {
  "ok": true,
  "query": "nintendo museum",
  "ms": 1794,
  "biasedTo": [
   34.97787,
   135.76039
  ],
  "count": 1,
  "results": [
   {
    "name": "Nintendo Museum",
    "type": "tourism=museum",
    "city": "Uji",
    "km": 9.7,
    "osm": "W263330850"
   }
  ]
 },
 "routes": {
  "from": "East Temple",
  "a": [
   34.98061,
   135.74771
  ],
  "b": [
   34.9874,
   135.76196
  ],
  "straightKm": 1.5,
  "walk": {
   "ok": true,
   "ms": 15,
   "minutes": 27,
   "km": 2,
   "points": 133
  },
  "taxi": {
   "ok": true,
   "ms": 16,
   "minutes": 5,
   "km": 2.1,
   "points": 110
  },
  "transit": {
   "ok": true,
   "api": "v6",
   "ms": 111,
   "time": "2026-09-27T01:00:00.000Z",
   "itineraries": 5,
   "withTransit": 5,
   "direct": 1,
   "best": {
    "minutes": 25,
    "transfers": 0,
    "legs": [
     "walk",
     "REGIONAL_RAIL 18999264",
     "walk"
    ]
   }
  }
 }
}
```

Google Maps opened in a separate window, confirmed by the owner.

The leg line reads `mode + (displayName || routeShortName)`, so `REGIONAL_RAIL 18999264` means
Transitous gave a numeric id where a line name was wanted.
