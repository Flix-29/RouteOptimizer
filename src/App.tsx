import './App.css'
import 'mapbox-gl/dist/mapbox-gl.css'

import React, {useEffect, useRef, useState} from "react";
import mapboxgl, {FullscreenControl, GeoJSONSource, GeolocateControl, NavigationControl} from 'mapbox-gl'
import {SearchBox as RawSearchBox} from '@mapbox/search-js-react';
import {FontAwesomeIcon} from "@fortawesome/react-fontawesome";
import {faXmark} from "@fortawesome/free-solid-svg-icons";
import {optimizeAndGetRoute} from "./mapboxApi/mapboxApiAccessor.ts";

import type {Stop} from "./model/Stop.ts";
import type {SearchBoxProps} from "@mapbox/search-js-react/dist/components/SearchBox";

const SearchBox = RawSearchBox as React.ForwardRefExoticComponent<React.PropsWithoutRef<SearchBoxProps>>;
const accessToken = "pk.eyJ1IjoiZmxpeDI5IiwiYSI6ImNtYXI1ZHI5YzA2Y3EybXM5ZjVrZWw0Z3gifQ.JznGkaiMFAghv0g9qHTJnQ"

function App() {
    const [inputValue, setInputValue] = useState("");
    const [address, setAddress] = useState("");
    const [marker, setMarker] = useState<mapboxgl.Marker>();
    const [location, setLocation] = useState<Stop>();
    const [stops, setStops] = useState<Stop[]>([]);
    const [isFirstLoad, setIsFirstLoad] = useState(true);
    const [routeCreated, setRouteCreated] = useState(false);

    const mapRef = useRef<mapboxgl.Map | undefined>(undefined)
    const mapContainerRef = useRef<HTMLDivElement>(null)
    const popUpRef = useRef<mapboxgl.Popup | undefined>(undefined)

    const popUpDiv = document.createElement('div');
    popUpRef.current = new mapboxgl.Popup({
        offset: 25,
        closeButton: true,
        closeOnClick: false,
    }).setDOMContent(popUpDiv);

    useEffect(() => {
        mapboxgl.accessToken = accessToken
        mapRef.current = new mapboxgl.Map({
            container: mapContainerRef.current as HTMLDivElement,
            center: [13.38076, 52.51024],
            zoom: 12,
        })
            .addControl(new NavigationControl(), 'top-right')
            .addControl(new GeolocateControl({
                positionOptions: {
                    enableHighAccuracy: true
                },
                trackUserLocation: true,
                showUserHeading: true
            }), 'top-right')
            .addControl(new FullscreenControl(), 'top-right')

        navigator.geolocation.getCurrentPosition(position => setLocation({
            name: "Current location",
            address: "Current location",
            longitude: position.coords.longitude,
            latitude: position.coords.latitude
        }))

        return () => {
            mapRef.current?.remove()
        }
    }, [])

    useEffect(() => {
        if (!location) {
            return;
        }
        mapRef.current?.setCenter({
            lat: location.latitude,
            lon: location.longitude,
        }).setZoom(14)
            .addLayer(
                {
                    id: 'location',
                    type: 'circle',
                    source: {
                        type: 'geojson',
                        data: {
                            type: 'FeatureCollection',
                            features: [
                                {
                                    type: 'Feature',
                                    geometry: {
                                        type: 'Point',
                                        coordinates: [location.longitude, location.latitude]
                                    },
                                    properties: {
                                        title: location.name,
                                        address: location.address
                                    }
                                }
                            ]
                        }
                    },
                    paint: {
                        'circle-radius': 8,
                        'circle-color': '#bc0d20',
                        'circle-stroke-width': 2,
                        'circle-stroke-color': '#ffffff'
                    }
                }
            )
    }, [location]);

    useEffect(() => {
        document.getElementById('add-stop-btn')?.addEventListener('click', () => {
            const stop: Stop = {
                name: inputValue,
                address: address,
                longitude: marker?.getLngLat().lng == undefined ? 0 : marker?.getLngLat().lng,
                latitude: marker?.getLngLat().lat == undefined ? 0 : marker?.getLngLat().lat
            }
            setStops(stops.concat(stop));
            marker?.togglePopup();
            marker?.remove();
        })
    });

    useEffect(() => {
        if (!mapRef.current?.isStyleLoaded() && isFirstLoad) {
            setIsFirstLoad(false);
            return;
        }
        if (mapRef.current?.getLayer('points-circle') || mapRef.current?.getLayer('points')) {
            mapRef.current.removeLayer('points-circle');
            mapRef.current.removeLayer('points');
            mapRef.current.removeSource('points');
        }
        if (mapRef.current?.getLayer('route') && !routeCreated) {
            mapRef.current.removeLayer('route');
            mapRef.current.removeSource('route');
        }
        setRouteCreated(false);
        if (!stops || stops.length === 0) {
            return;
        }
        mapRef.current?.addSource('points', {
            'type': 'geojson',
            'data': {
                'type': 'FeatureCollection',
                'features': stops.map(stop => {
                    return {
                        'type': 'Feature',
                        'geometry': {
                            'type': 'Point',
                            'coordinates': [stop.longitude, stop.latitude]
                        },
                        'properties': {
                            'title': stop.name,
                            'address': stop.address
                        }
                    }
                })
            }
        });
        mapRef.current?.addLayer({
            'id': 'points-circle',
            'type': 'circle',
            'source': 'points',
            'paint': {
                'circle-radius': 8,
                'circle-color': '#3887be',
                'circle-stroke-width': 2,
                'circle-stroke-color': '#ffffff'
            }
        });
        mapRef.current?.addLayer({
            'id': 'points',
            'type': 'symbol',
            'source': 'points',
            'layout': {
                'text-field': ['get', 'title'],
                'text-font': ['Open Sans Semibold', 'Arial Unicode MS Bold'],
                'text-offset': [0, 0.5],
                'text-anchor': 'top'
            },
        });
    }, [stops, isFirstLoad]);

    async function startRoute() {
        const routeStops = [location].concat(stops) as Stop[];
        const response = optimizeAndGetRoute(routeStops);
        response.then(data => {
            const updatedStops = stops.map((stop, i) => {
                if (i >= data.waypoints.length - 1) return stop;

                return {
                    ...stop,
                    index: data.waypoints[i + 1].waypoint_index
                };
            });

            setStops(updatedStops);
        });
        const geojson: GeoJSON.GeoJSON = {
            'type': 'Feature',
            'properties': {},
            'geometry': await response.then(data => data.trips[0].geometry)
        };

        if (mapRef.current?.getSource('route')) {
            (mapRef.current.getSource('route') as GeoJSONSource).setData(geojson);
        } else {
            mapRef.current?.addLayer({
                id: 'route',
                type: 'line',
                source: {
                    type: 'geojson',
                    data: geojson
                },
                layout: {
                    'line-join': 'round',
                    'line-cap': 'round'
                },
                paint: {
                    'line-color': '#2ca4bf',
                    'line-width': 8
                }
            });
        }
        setRouteCreated(true);
    }

    return (
        <>
            <div id="searchbox">
                <SearchBox
                    accessToken={accessToken}
                    map={mapRef.current}
                    mapboxgl={mapboxgl}
                    value={inputValue}
                    onChange={(d) => {
                        setInputValue(d);
                    }}
                    onRetrieve={(response) => {
                        const name = response.features.map(value => value.properties.name)[0];
                        const address = response.features.map(value => value.properties.full_address)[0];
                        const longitude = response.features[0].geometry.coordinates[0];
                        const latitude = response.features[0].geometry.coordinates[1];

                        setInputValue(name)
                        setAddress(address)

                        if (marker) {
                            marker.remove()
                        }

                        popUpRef.current?.remove()
                        popUpDiv.innerHTML = `${name} <br> ${address} <br>
                            <button type="button" id="add-stop-btn" class="rounded p-1 mt-1">Add Stop</button>`;

                        const newMarker = new mapboxgl.Marker()
                            .setLngLat([longitude, latitude])
                            .setPopup(popUpRef.current)
                            .addTo(mapRef.current as mapboxgl.Map)
                            .togglePopup();
                        setMarker(newMarker)
                        mapRef.current?.flyTo({
                            center: [longitude, latitude],
                            zoom: 14
                        })
                    }}
                />
            </div>
            {stops && stops.length > 0 &&
                <div id="stops" className="p-2">
                    <h2>Stops</h2>
                    <ul>
                        {stops.map((stop, index) => (
                            <li key={index}>
                                <div className="flex mt-2 rounded-lg bg-gray-100 p-2">
                                    {stops && stops.filter(item => item.index !== undefined).length > 0 &&
                                        <div className="flex items-center m-2 mr-3">
                                            <b>{stop.index}.</b>
                                        </div>
                                    }
                                    <div>
                                        <p>{stop.name}</p>
                                        <p className="text-xs">{stop.address}</p>
                                    </div>
                                    <>
                                        <button type="button" className="rounded p-2 ml-auto" id="delete-stop-btn"
                                                onClick={() => {
                                                    setStops(stops => stops.filter(item => item !== stop));
                                                    stops.map(stop => stop.index = undefined);
                                                }}>
                                            <FontAwesomeIcon icon={faXmark}/>
                                        </button>
                                    </>
                                </div>
                            </li>
                        ))}
                    </ul>
                    <div className="flex m-3 mb-0 justify-between">
                        <button type="button" id="start-route" className="rounded p-2"
                                onClick={() => startRoute()}>Optimize route
                        </button>
                        <button type="button" id="clear-route" className="rounded p-2"
                                onClick={() => setStops([])}>Clear route
                        </button>
                    </div>
                </div>
            }
            <div id="map-container" ref={mapContainerRef}/>
        </>
    )
}

export default App
