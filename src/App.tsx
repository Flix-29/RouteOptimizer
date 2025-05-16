import {useEffect, useRef, useState} from "react";
import mapboxgl, {FullscreenControl, GeolocateControl, NavigationControl} from 'mapbox-gl'
import {SearchBox} from "@mapbox/search-js-react";

import 'mapbox-gl/dist/mapbox-gl.css'

import './App.css'

const accessToken = "pk.eyJ1IjoiZmxpeDI5IiwiYSI6ImNtYXI1ZHI5YzA2Y3EybXM5ZjVrZWw0Z3gifQ.JznGkaiMFAghv0g9qHTJnQ"

function App() {
    const [inputValue, setInputValue] = useState("");
    const [marker, setMarker] = useState<mapboxgl.Marker | null>(null);

    const mapRef = useRef<mapboxgl.Map | undefined>(undefined)
    const mapContainerRef = useRef<HTMLDivElement>(null)

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

        return () => {
            mapRef.current?.remove()
        }
    }, [])

    const popUp = new mapboxgl.Popup({
        offset: 25,
        closeButton: true,
        closeOnClick: false,
    });

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

                        if (marker) {
                            marker.remove()
                        }

                        const newMarker = new mapboxgl.Marker()
                            .setLngLat([longitude, latitude])
                            .setPopup(popUp.setHTML(name + "<br>" + address))
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
            <div id="map-container" ref={mapContainerRef}/>
        </>
    )
}

export default App
