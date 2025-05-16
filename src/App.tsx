import {useEffect, useRef, useState} from "react";
import mapboxgl, {FullscreenControl, GeolocateControl, NavigationControl} from 'mapbox-gl'
import {SearchBox} from "@mapbox/search-js-react";

import 'mapbox-gl/dist/mapbox-gl.css'

import './App.css'

const accessToken = "pk.eyJ1IjoiZmxpeDI5IiwiYSI6ImNtYXI1ZHI5YzA2Y3EybXM5ZjVrZWw0Z3gifQ.JznGkaiMFAghv0g9qHTJnQ"

function App() {
    const [inputValue, setInputValue] = useState("");

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
                    marker
                />
            </div>
            <div id="map-container" ref={mapContainerRef}/>
        </>
    )
}

export default App
