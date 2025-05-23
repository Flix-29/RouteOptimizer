import type {Stop} from "../model/Stop.ts";

export async function optimizeAndGetRoute(stops: Stop[]) {
    const accessToken = "pk.eyJ1IjoiZmxpeDI5IiwiYSI6ImNtYXI1ZHI5YzA2Y3EybXM5ZjVrZWw0Z3gifQ.JznGkaiMFAghv0g9qHTJnQ"

    const url = `https://api.mapbox.com/optimized-trips/v1/mapbox/driving-traffic/${stops.map(stop => `${stop.longitude},${stop.latitude}`).join(";")}?geometries=geojson&overview=full&steps=true&source=first&destination=any&roundtrip=true&access_token=${accessToken}`

    const response = await fetch(url, {method: "GET"})

    if (!response.ok) {
        throw new Error("Failed to fetch route. Status:" + response.status);
    }

    return await response.json();
}