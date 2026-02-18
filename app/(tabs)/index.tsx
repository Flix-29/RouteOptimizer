import {MapView, LocationPuck, Camera} from '@rnmapbox/maps';
import {StyleSheet, Platform} from 'react-native';
import {useEffect, useState} from "react";
import * as Location from 'expo-location';

const requestLocationPermission = async () => {
    try {
        const {status} = await Location.requestForegroundPermissionsAsync();
        return status === Location.PermissionStatus.GRANTED;
    } catch (error) {
        console.warn('Failed to request location permission', error);
        return false;
    }
};

export default function Index() {
    const [hasLocationPermission, setHasLocationPermission] = useState(false);
    const [userCoordinate, setUserCoordinate] = useState<[number, number] | null>(null);

    useEffect(() => {
        let isMounted = true;

        const checkPermission = async () => {
            const granted = await requestLocationPermission();
            if (isMounted) {
                setHasLocationPermission(granted);
            }

            if (!granted) {
                return;
            }

            try {
                const position = await Location.getCurrentPositionAsync({
                    accuracy: Location.Accuracy.Balanced,
                });
                if (isMounted) {
                    setUserCoordinate([
                        position.coords.longitude,
                        position.coords.latitude,
                    ]);
                }
            } catch (error) {
                console.warn('Failed to get current location', error);
            }
        };

        checkPermission();

        return () => {
            isMounted = false;
        };
    }, []);

    return (
        <MapView
            styleURL={"mapbox://styles/mapbox/standard"}
            style={styles.map}
            projection='globe'
            scaleBarEnabled={false}
            logoPosition={Platform.OS === 'android' ? {bottom: 40, left: 10} : undefined}
            attributionPosition={Platform.OS === 'android' ? {bottom: 40, right: 10} : undefined}
        >
            <Camera
                centerCoordinate={userCoordinate ?? undefined}
                animationDuration={900}
                followUserLocation={hasLocationPermission}
                followZoomLevel={14}
                defaultSettings={{
                    centerCoordinate: [-43.2268, -22.9358],
                    zoomLevel: 12.1,
                }}
            />
            {hasLocationPermission && (
                <LocationPuck
                    puckBearingEnabled
                    puckBearing="heading"
                    pulsing={{isEnabled: true}}
                />
            )}
        </MapView>
    );
}

const styles = StyleSheet.create({
    map: {
        flex: 1,
        width: '100%',
    },
});
