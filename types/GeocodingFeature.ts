export type GeocodingFeature = {
    id: string;
    geometry: {
        coordinates: [number, number];
    };
    text?: string;
    place_name?: string;
    place_formatted?: string;
    properties?: {
        name?: string;
        full_address?: string;
    };
};