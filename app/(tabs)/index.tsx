import FontAwesome from '@expo/vector-icons/FontAwesome';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import Mapbox, {Camera, CircleLayer, LineLayer, LocationPuck, MapView, ShapeSource, SymbolLayer} from '@rnmapbox/maps';
import type {Feature, FeatureCollection, LineString, Point} from 'geojson';
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
    ActivityIndicator,
    FlatList,
    Platform,
    Pressable,
    ScrollView,
    Switch,
    StyleSheet,
    Text,
    TextInput,
    View,
    useWindowDimensions,
} from 'react-native';
import * as Location from 'expo-location';

import {GeocodingFeature} from '@/types/GeocodingFeature';

const MAPBOX_ACCESS_TOKEN = process.env.EXPO_PUBLIC_MAP_KEY ?? '';
const DEFAULT_CENTER: [number, number] = [-122.4194, 37.7749];
const DEFAULT_ZOOM = 12.1;

const ROUTE_LINE_STYLE = {
    lineColor: '#0B84FF',
    lineWidth: 5,
    lineOpacity: 0.92,
    lineCap: 'round',
    lineJoin: 'round',
} as const;

const STOP_CIRCLE_STYLE = {
    circleRadius: 14,
    circleColor: '#1C8AFF',
    circleStrokeColor: '#FFFFFF',
    circleStrokeWidth: 2,
} as const;

const STOP_LABEL_STYLE = {
    textField: ['get', 'label'],
    textSize: 12,
    textColor: '#FFFFFF',
    textAllowOverlap: true,
    textIgnorePlacement: true,
} as const;

interface Stop {
    id: string;
    title: string;
    coordinate: [number, number];
}

interface StopFeatureProperties {
    label: string;
}

interface OptimizedWaypoint {
    waypoint_index: number;
}

interface OptimizedTrip {
    distance?: number;
    duration?: number;
    geometry?: {
        coordinates: [number, number][];
    };
}

interface OptimizedTripResponse {
    code?: string;
    message?: string;
    trips?: OptimizedTrip[];
    waypoints?: OptimizedWaypoint[];
}

if (MAPBOX_ACCESS_TOKEN) {
    Mapbox.setAccessToken(MAPBOX_ACCESS_TOKEN);
}

const requestLocationPermission = async () => {
    try {
        const {status} = await Location.requestForegroundPermissionsAsync();
        return status === Location.PermissionStatus.GRANTED;
    } catch (error) {
        console.warn('Failed to request location permission', error);
        return false;
    }
};

const buildStopId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const stopTitleFromSearchResult = (result: GeocodingFeature) => (
    result.properties?.full_address
    ?? result.place_name
    ?? result.place_formatted
    ?? result.properties?.name
    ?? result.text
    ?? 'Selected stop'
);

const reorderStopsByWaypointIndex = (
    currentStops: Stop[],
    waypoints?: OptimizedWaypoint[],
    waypointOffset = 0,
): Stop[] | null => {
    if (!waypoints || waypoints.length < currentStops.length + waypointOffset) {
        return null;
    }

    const indexedStops = currentStops.map((stop, originalIndex) => ({
        waypointIndex: waypoints[originalIndex + waypointOffset]?.waypoint_index,
        stop,
    }));

    if (indexedStops.some((entry) => !Number.isFinite(entry.waypointIndex) || !entry.stop)) {
        return null;
    }

    return indexedStops
        .sort((left, right) => left.waypointIndex - right.waypointIndex)
        .map((entry) => entry.stop);
};

const buildMapboxError = (service: string, status: number, details: string) => {
    const detailText = details.trim();

    if (status === 403) {
        return `${service} returned 403. Check token scopes/URL restrictions and account access. ${detailText}`.trim();
    }

    if (status === 401) {
        return `${service} returned 401. Check that your Mapbox token is valid and has required permissions. ${detailText}`.trim();
    }

    return `${service} failed (${status}). ${detailText}`.trim();
};

export default function Index() {
    const {height: screenHeight} = useWindowDimensions();

    const [hasLocationPermission, setHasLocationPermission] = useState(false);
    const [followUserLocation, setFollowUserLocation] = useState(false);
    const [userCoordinate, setUserCoordinate] = useState<[number, number] | null>(null);
    const [, setZoomLevel] = useState(DEFAULT_ZOOM);
    const [isSatellite, setIsSatellite] = useState(false);

    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState<GeocodingFeature[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const [searchError, setSearchError] = useState<string | null>(null);

    const [stops, setStops] = useState<Stop[]>([]);
    const [routeCoordinates, setRouteCoordinates] = useState<[number, number][]>([]);
    const [routeDistanceMeters, setRouteDistanceMeters] = useState<number | null>(null);
    const [routeDurationSeconds, setRouteDurationSeconds] = useState<number | null>(null);
    const [isOptimizing, setIsOptimizing] = useState(false);
    const [optimizeError, setOptimizeError] = useState<string | null>(null);
    const [includeCurrentLocationInRoute, setIncludeCurrentLocationInRoute] = useState(false);

    const [isSheetOpen, setIsSheetOpen] = useState(false);

    const cameraRef = useRef<Camera>(null);
    const searchInputRef = useRef<TextInput>(null);

    const expandedSheetHeight = useMemo(
        () => Math.min(screenHeight * 0.74, 620),
        [screenHeight],
    );
    const sheetHeight = isSheetOpen ? expandedSheetHeight : 190;

    const resetOptimizedRoute = useCallback(() => {
        setRouteCoordinates([]);
        setRouteDistanceMeters(null);
        setRouteDurationSeconds(null);
    }, []);

    const centerCamera = useCallback((longitude: number, latitude: number, nextZoom = 14) => {
        setZoomLevel(nextZoom);
        cameraRef.current?.setCamera({
            centerCoordinate: [longitude, latitude],
            zoomLevel: nextZoom,
            animationDuration: 700,
        });
    }, []);

    const fitCameraToCoordinates = useCallback((coordinates: [number, number][]) => {
        if (coordinates.length === 0) {
            return;
        }

        let minLongitude = Number.POSITIVE_INFINITY;
        let minLatitude = Number.POSITIVE_INFINITY;
        let maxLongitude = Number.NEGATIVE_INFINITY;
        let maxLatitude = Number.NEGATIVE_INFINITY;

        coordinates.forEach(([longitude, latitude]) => {
            minLongitude = Math.min(minLongitude, longitude);
            minLatitude = Math.min(minLatitude, latitude);
            maxLongitude = Math.max(maxLongitude, longitude);
            maxLatitude = Math.max(maxLatitude, latitude);
        });

        if (!Number.isFinite(minLongitude) || !Number.isFinite(minLatitude) || !Number.isFinite(maxLongitude) || !Number.isFinite(maxLatitude)) {
            return;
        }

        const minimumSpan = 0.002;
        if (maxLongitude - minLongitude < minimumSpan) {
            maxLongitude += minimumSpan / 2;
            minLongitude -= minimumSpan / 2;
        }

        if (maxLatitude - minLatitude < minimumSpan) {
            maxLatitude += minimumSpan / 2;
            minLatitude -= minimumSpan / 2;
        }

        setFollowUserLocation(false);
        cameraRef.current?.fitBounds(
            [maxLongitude, maxLatitude],
            [minLongitude, minLatitude],
            [72, 40, sheetHeight + 20, 40],
            700,
        );
    }, [sheetHeight]);

    const appendStop = useCallback((stop: Stop) => {
        resetOptimizedRoute();
        setOptimizeError(null);
        setStops((previousStops) => [...previousStops, stop]);
    }, [resetOptimizedRoute]);

    const canIncludeCurrentLocationInRoute = hasLocationPermission && Boolean(userCoordinate);

    useEffect(() => {
        if (!canIncludeCurrentLocationInRoute && includeCurrentLocationInRoute) {
            setIncludeCurrentLocationInRoute(false);
        }
    }, [canIncludeCurrentLocationInRoute, includeCurrentLocationInRoute]);

    const onToggleIncludeCurrentLocation = useCallback((nextValue: boolean) => {
        setIncludeCurrentLocationInRoute(nextValue);
        resetOptimizedRoute();
        setOptimizeError(null);
    }, [resetOptimizedRoute]);

    const refollowUserLocation = () => {
        if (!userCoordinate) {
            return;
        }
        setFollowUserLocation(true);
        setSearchResults([]);
        centerCamera(userCoordinate[0], userCoordinate[1], 14);
    };

    const zoomBy = (delta: number) => {
        setFollowUserLocation(false);
        setZoomLevel((previousZoom) => {
            const nextZoom = Math.max(2, Math.min(20, previousZoom + delta));
            cameraRef.current?.zoomTo(nextZoom, 200);
            return nextZoom;
        });
    };

    useEffect(() => {
        let isMounted = true;

        const checkPermission = async () => {
            const granted = await requestLocationPermission();
            if (isMounted) {
                setHasLocationPermission(granted);
                setFollowUserLocation(granted);
            }

            if (!granted) {
                return;
            }

            try {
                const position = await Location.getCurrentPositionAsync({
                    accuracy: Location.Accuracy.Balanced,
                });
                if (isMounted) {
                    const coordinate: [number, number] = [
                        position.coords.longitude,
                        position.coords.latitude,
                    ];
                    setUserCoordinate(coordinate);
                }
            } catch (error) {
                console.warn('Failed to get current location', error);
            }
        };

        void checkPermission();

        return () => {
            isMounted = false;
        };
    }, []);

    useEffect(() => {
        if (searchQuery.trim().length < 3) {
            setSearchResults([]);
            setIsSearching(false);
            setSearchError(null);
            return;
        }

        if (!MAPBOX_ACCESS_TOKEN) {
            setSearchResults([]);
            setIsSearching(false);
            setSearchError('Missing EXPO_PUBLIC_MAP_KEY. Restart Expo after updating .env.');
            return;
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(async () => {
            setIsSearching(true);
            setSearchError(null);

            try {
                const encodedQuery = encodeURIComponent(searchQuery.trim());
                const response = await fetch(
                    `https://api.mapbox.com/search/geocode/v6/forward?q=${encodedQuery}&autocomplete=true&limit=6&access_token=${MAPBOX_ACCESS_TOKEN}`,
                    {signal: controller.signal},
                );

                if (!response.ok) {
                    const details = await response.text();
                    throw new Error(`Geocoding failed: ${response.status} ${details}`);
                }

                const data = await response.json() as {features?: GeocodingFeature[]};
                setSearchResults(data.features ?? []);
            } catch (error) {
                if (error instanceof Error && error.name === 'AbortError') {
                    return;
                }
                console.warn('Failed to geocode search input', error);
                setSearchResults([]);
                setSearchError('Search failed. Check network and Mapbox token permissions.');
            } finally {
                setIsSearching(false);
            }
        }, 300);

        return () => {
            clearTimeout(timeoutId);
            controller.abort();
        };
    }, [searchQuery]);

    const selectSearchResult = (result: GeocodingFeature) => {
        const [longitude, latitude] = result.geometry.coordinates;
        const title = stopTitleFromSearchResult(result);

        setFollowUserLocation(false);
        setSearchResults([]);
        setSearchError(null);
        centerCamera(longitude, latitude, 14);

        appendStop({
            id: buildStopId(),
            title,
            coordinate: [longitude, latitude],
        });

        setSearchQuery('');
        setIsSheetOpen(true);
    };

    const removeStop = useCallback((stopId: string) => {
        resetOptimizedRoute();
        setOptimizeError(null);
        setStops((previousStops) => previousStops.filter((stop) => stop.id !== stopId));
    }, [resetOptimizedRoute]);

    const optimizeRoute = useCallback(async () => {
        if (stops.length < 2) {
            setOptimizeError('Add at least two stops before optimizing.');
            return;
        }

        if (includeCurrentLocationInRoute && !userCoordinate) {
            setOptimizeError('Current location is unavailable right now.');
            return;
        }

        const maxStops = includeCurrentLocationInRoute ? 11 : 12;
        if (stops.length > maxStops) {
            setOptimizeError(`Mapbox Optimization supports up to ${maxStops} stops with current settings.`);
            return;
        }

        if (!MAPBOX_ACCESS_TOKEN) {
            setOptimizeError('Missing EXPO_PUBLIC_MAP_KEY. Restart Expo after updating .env.');
            return;
        }

        setIsOptimizing(true);
        setOptimizeError(null);

        const currentStops = [...stops];
        const shouldIncludeUserCoordinate = includeCurrentLocationInRoute && Boolean(userCoordinate);
        const coordinatesForOptimization = shouldIncludeUserCoordinate && userCoordinate
            ? [userCoordinate, ...currentStops.map((stop) => stop.coordinate)]
            : currentStops.map((stop) => stop.coordinate);
        const waypointOffset = shouldIncludeUserCoordinate ? 1 : 0;

        try {
            const coordinates = coordinatesForOptimization
                .map((coordinate) => `${coordinate[0]},${coordinate[1]}`)
                .join(';');

            const query = new URLSearchParams({
                access_token: MAPBOX_ACCESS_TOKEN,
                geometries: 'geojson',
                overview: 'full',
                source: 'first',
                destination: 'last',
                roundtrip: 'false',
            });

            const response = await fetch(
                `https://api.mapbox.com/optimized-trips/v1/mapbox/driving/${coordinates}?${query.toString()}`,
            );

            if (!response.ok) {
                const details = await response.text();
                throw new Error(buildMapboxError('Optimization', response.status, details));
            }

            const data = await response.json() as OptimizedTripResponse;
            if (data.code && data.code !== 'Ok') {
                throw new Error(data.message ?? 'Optimization request failed.');
            }

            const bestTrip = data.trips?.[0];
            const geometryCoordinates = bestTrip?.geometry?.coordinates;
            if (!geometryCoordinates || geometryCoordinates.length < 2) {
                throw new Error('Optimization returned no route geometry.');
            }

            setRouteCoordinates(geometryCoordinates);
            setRouteDistanceMeters(bestTrip.distance ?? null);
            setRouteDurationSeconds(bestTrip.duration ?? null);

            const reorderedStops = reorderStopsByWaypointIndex(currentStops, data.waypoints, waypointOffset);
            if (reorderedStops) {
                setStops(reorderedStops);
            }

            fitCameraToCoordinates(geometryCoordinates);
        } catch (error) {
            console.warn('Failed to optimize route', error);
            resetOptimizedRoute();
            if (error instanceof Error) {
                setOptimizeError(error.message);
            } else {
                setOptimizeError('Route optimization failed. Check token permissions and network.');
            }
        } finally {
            setIsOptimizing(false);
        }
    }, [fitCameraToCoordinates, includeCurrentLocationInRoute, resetOptimizedRoute, stops, userCoordinate]);

    const focusSearchForStop = () => {
        setIsSheetOpen(false);
        setSearchResults([]);
        searchInputRef.current?.focus();
    };

    const focusOnRoute = () => {
        if (routeCoordinates.length > 1) {
            fitCameraToCoordinates(routeCoordinates);
            return;
        }

        if (stops.length > 0) {
            fitCameraToCoordinates(stops.map((stop) => stop.coordinate));
        }
    };

    const toggleMapStyle = () => {
        setIsSatellite((previous) => !previous);
    };

    const routeShape = useMemo<Feature<LineString> | null>(() => {
        if (routeCoordinates.length < 2) {
            return null;
        }

        return {
            type: 'Feature',
            properties: {},
            geometry: {
                type: 'LineString',
                coordinates: routeCoordinates,
            },
        };
    }, [routeCoordinates]);

    const stopShape = useMemo<FeatureCollection<Point, StopFeatureProperties> | null>(() => {
        if (stops.length === 0) {
            return null;
        }

        return {
            type: 'FeatureCollection',
            features: stops.map((stop, index) => ({
                type: 'Feature',
                id: stop.id,
                properties: {
                    label: `${index + 1}`,
                },
                geometry: {
                    type: 'Point',
                    coordinates: stop.coordinate,
                },
            })),
        };
    }, [stops]);

    const durationText = routeDurationSeconds === null
        ? '--'
        : (() => {
            const totalMinutes = Math.max(1, Math.round(routeDurationSeconds / 60));
            if (totalMinutes < 60) {
                return `${totalMinutes} min`;
            }

            const hours = Math.floor(totalMinutes / 60);
            const remainingMinutes = totalMinutes % 60;
            return remainingMinutes === 0
                ? `${hours} hr`
                : `${hours} hr ${remainingMinutes} min`;
        })();
    const distanceText = routeDistanceMeters === null
        ? '--'
        : (routeDistanceMeters / 1000).toFixed(1);

    const summarySubtitle = isOptimizing
        ? 'Optimizing route...'
        : routeCoordinates.length > 1
            ? `Optimized for ${stops.length} stops`
            : stops.length < 2
                ? 'Use search to add at least 2 stops'
                : includeCurrentLocationInRoute
                    ? 'Ready to optimize from your current location'
                    : 'Ready to find best route';

    return (
        <View style={styles.container}>
            <MapView
                styleURL={isSatellite ? 'mapbox://styles/mapbox/satellite-streets-v12' : 'mapbox://styles/mapbox/standard'}
                style={styles.map}
                projection="globe"
                scaleBarEnabled={false}
                logoPosition={Platform.OS === 'android' ? {bottom: sheetHeight + 10, left: 10} : undefined}
                attributionPosition={Platform.OS === 'android' ? {bottom: sheetHeight + 10, right: 10} : undefined}
                onPress={() => setSearchResults([])}
            >
                <Camera
                    ref={cameraRef}
                    centerCoordinate={userCoordinate ?? undefined}
                    followUserLocation={followUserLocation}
                    followZoomLevel={14}
                    defaultSettings={{
                        centerCoordinate: DEFAULT_CENTER,
                        zoomLevel: DEFAULT_ZOOM,
                    }}
                />

                {routeShape && (
                    <ShapeSource id="optimizedRouteSource" shape={routeShape}>
                        <LineLayer id="optimizedRouteLayer" style={ROUTE_LINE_STYLE}/>
                    </ShapeSource>
                )}

                {stopShape && (
                    <ShapeSource id="stopsSource" shape={stopShape}>
                        <CircleLayer id="stopsCircleLayer" style={STOP_CIRCLE_STYLE}/>
                        <CircleLayer
                            id="stopsCenterDotLayer"
                            style={{
                                circleRadius: 4,
                                circleColor: '#FFFFFF',
                            }}
                        />
                        <SymbolLayer id="stopsLabelLayer" style={STOP_LABEL_STYLE}/>
                    </ShapeSource>
                )}

                {hasLocationPermission && (
                    <LocationPuck
                        puckBearingEnabled
                        puckBearing="heading"
                        pulsing={{isEnabled: true}}
                    />
                )}
            </MapView>

            <View style={styles.topControls}>
                <View style={styles.searchArea}>
                    <View style={styles.searchInputWrapper}>
                        <FontAwesome name="search" size={16} color="#94A3B8"/>
                        <TextInput
                            ref={searchInputRef}
                            value={searchQuery}
                            onChangeText={setSearchQuery}
                            placeholder="Search for a stop..."
                            placeholderTextColor="#8B97AA"
                            autoCapitalize="none"
                            autoCorrect={false}
                            style={styles.searchInput}
                        />
                        {isSearching && <ActivityIndicator size="small" color="#0B84FF"/>}
                    </View>
                    {searchResults.length > 0 && (
                        <FlatList
                            data={searchResults}
                            keyExtractor={(item) => item.id}
                            style={styles.searchResults}
                            keyboardShouldPersistTaps="handled"
                            renderItem={({item}) => (
                                <Pressable
                                    style={styles.searchResult}
                                    onPress={() => selectSearchResult(item)}
                                >
                                    <Text numberOfLines={1} style={styles.searchTitle}>
                                        {item.properties?.name ?? item.text ?? item.place_formatted ?? 'Result'}
                                    </Text>
                                    <Text numberOfLines={1} style={styles.searchSubtitle}>
                                        {item.properties?.full_address ?? item.place_name ?? item.place_formatted ?? ''}
                                    </Text>
                                </Pressable>
                            )}
                        />
                    )}
                    {searchError && <Text style={styles.searchError}>{searchError}</Text>}
                </View>

                <Pressable style={styles.roundControlButton} onPress={refollowUserLocation}>
                    <FontAwesome name="crosshairs" size={20} color="#38475A"/>
                </Pressable>
            </View>

            <View style={styles.rightControls}>
                <View style={styles.zoomControlGroup}>
                    <Pressable style={styles.stackedControlButton} onPress={() => zoomBy(1)}>
                        <FontAwesome name="plus" size={20} color="#2F3A4A"/>
                    </Pressable>
                    <View style={styles.zoomDivider}/>
                    <Pressable style={styles.stackedControlButton} onPress={() => zoomBy(-1)}>
                        <FontAwesome name="minus" size={20} color="#2F3A4A"/>
                    </Pressable>
                </View>
                <Pressable style={[styles.roundControlButton, styles.layerControlButton]} onPress={toggleMapStyle}>
                    <MaterialCommunityIcons name="layers-triple-outline" size={21} color="#2F3A4A"/>
                </Pressable>
            </View>

            <View style={[styles.bottomSheet, {height: sheetHeight}]}>
                <Pressable style={styles.sheetHandleTouch} onPress={() => setIsSheetOpen((previous) => !previous)}>
                    <View style={styles.sheetHandle}/>
                </Pressable>

                <View style={styles.summaryRow}>
                    <View style={styles.summaryTextBlock}>
                        <Text style={styles.summaryTitle}>
                            {durationText} <Text style={styles.summaryDistance}>({distanceText} km)</Text>
                        </Text>
                        <Text style={styles.summarySubtitle}>{summarySubtitle}</Text>
                    </View>
                </View>

                <View style={styles.primaryActionsRow}>
                    <Pressable
                        style={[
                            styles.startNavigationButton,
                            (stops.length < 2 || isOptimizing) && styles.disabledPrimaryButton,
                        ]}
                        onPress={() => {
                            void optimizeRoute();
                        }}
                        disabled={stops.length < 2 || isOptimizing}
                    >
                        {isOptimizing ? (
                            <ActivityIndicator size="small" color="#FFFFFF"/>
                        ) : (
                            <FontAwesome name="magic" size={20} color="#FFFFFF"/>
                        )}
                        <Text style={styles.startNavigationText}>Find Best Route</Text>
                    </Pressable>
                    <Pressable style={styles.shareButton} onPress={focusOnRoute}>
                        <FontAwesome name="location-arrow" size={20} color="#0B84FF"/>
                    </Pressable>
                </View>

                <View style={styles.locationToggleRow}>
                    <Text style={styles.locationToggleLabel}>Start from my location</Text>
                    <Switch
                        value={includeCurrentLocationInRoute}
                        onValueChange={onToggleIncludeCurrentLocation}
                        disabled={!canIncludeCurrentLocationInRoute || isOptimizing}
                        trackColor={{false: '#CBD5E1', true: '#7FC0FF'}}
                        thumbColor={includeCurrentLocationInRoute ? '#0B84FF' : '#F8FAFC'}
                        ios_backgroundColor="#CBD5E1"
                    />
                </View>
                {!canIncludeCurrentLocationInRoute && (
                    <Text style={styles.locationToggleHint}>
                        Allow location access to include your current position.
                    </Text>
                )}

                {optimizeError && <Text style={styles.optimizeError}>{optimizeError}</Text>}

                {isSheetOpen && (
                    <>
                        <View style={styles.sheetDivider}/>
                        <ScrollView
                            style={styles.sheetExpandedArea}
                            contentContainerStyle={styles.sheetExpandedContent}
                            showsVerticalScrollIndicator={false}
                        >
                            <View style={styles.routeStopsHeader}>
                                <Text style={styles.routeStopsTitle}>Route Stops</Text>
                                <Pressable
                                    style={[
                                        styles.optimizeButton,
                                        (stops.length < 2 || isOptimizing) && styles.disabledOptimizeButton,
                                    ]}
                                    onPress={() => {
                                        void optimizeRoute();
                                    }}
                                    disabled={stops.length < 2 || isOptimizing}
                                >
                                    <FontAwesome name="magic" size={13} color="#0B84FF"/>
                                    <Text style={styles.optimizeButtonText}>Optimize Route</Text>
                                </Pressable>
                            </View>

                            {stops.length === 0 && (
                                <Text style={styles.emptyStopsText}>
                                    Add stops by selecting places in the search results.
                                </Text>
                            )}

                            {stops.map((stop, index) => (
                                <View key={stop.id}>
                                    <View style={styles.stopRow}>
                                        <View style={styles.stopBadge}>
                                            <Text style={styles.stopBadgeText}>{index + 1}</Text>
                                        </View>
                                        <View style={styles.stopValuePill}>
                                            <Text style={styles.stopText} numberOfLines={1}>
                                                {stop.title}
                                            </Text>
                                        </View>
                                        <Pressable hitSlop={8} onPress={() => removeStop(stop.id)}>
                                            <FontAwesome name="times" size={18} color="#94A3B8"/>
                                        </Pressable>
                                    </View>
                                    {index < stops.length - 1 && <View style={styles.stopConnector}/>}
                                </View>
                            ))}

                            <Pressable style={styles.addStopButton} onPress={focusSearchForStop}>
                                <FontAwesome name="plus-circle" size={17} color="#0B84FF"/>
                                <Text style={styles.addStopText}>Add another stop</Text>
                            </Pressable>

                            <View style={styles.sheetDivider}/>
                        </ScrollView>
                    </>
                )}
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#D8ECF7',
    },
    map: {
        flex: 1,
        width: '100%',
    },
    topControls: {
        position: 'absolute',
        top: Platform.OS === 'ios' ? 56 : 26,
        left: 14,
        right: 14,
        flexDirection: 'row',
        alignItems: 'flex-start',
        zIndex: 20,
    },
    searchArea: {
        flex: 1,
    },
    searchInputWrapper: {
        backgroundColor: '#F4F7FB',
        borderRadius: 30,
        paddingHorizontal: 16,
        height: 46,
        flexDirection: 'row',
        alignItems: 'center',
        shadowColor: '#000000',
        shadowOpacity: 0.12,
        shadowRadius: 11,
        shadowOffset: {width: 0, height: 5},
        elevation: 3,
    },
    searchInput: {
        flex: 1,
        marginLeft: 10,
        fontSize: 16,
        color: '#1E2D3D',
    },
    roundControlButton: {
        width: 44,
        height: 44,
        borderRadius: 22,
        backgroundColor: '#F4F7FB',
        alignItems: 'center',
        justifyContent: 'center',
        marginLeft: 12,
        shadowColor: '#000000',
        shadowOpacity: 0.14,
        shadowRadius: 10,
        shadowOffset: {width: 0, height: 5},
        elevation: 4,
    },
    searchResults: {
        marginTop: 8,
        backgroundColor: '#FFFFFF',
        borderRadius: 18,
        maxHeight: 230,
    },
    searchResult: {
        paddingHorizontal: 14,
        paddingVertical: 11,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: '#DFE7F1',
    },
    searchTitle: {
        fontSize: 15,
        color: '#111827',
        fontWeight: '600',
    },
    searchSubtitle: {
        fontSize: 13,
        color: '#64748B',
        marginTop: 2,
    },
    searchError: {
        marginTop: 8,
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 12,
        backgroundColor: '#FEF2F2',
        color: '#B91C1C',
        fontSize: 13,
    },
    rightControls: {
        position: 'absolute',
        right: 14,
        top: Platform.OS === 'ios' ? 108 : 78,
        zIndex: 19,
        alignItems: 'center',
    },
    zoomControlGroup: {
        width: 44,
        borderRadius: 22,
        backgroundColor: '#F4F7FB',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        shadowColor: '#000000',
        shadowOpacity: 0.12,
        shadowRadius: 10,
        shadowOffset: {width: 0, height: 5},
        elevation: 4,
        marginLeft: 12,
    },
    stackedControlButton: {
        width: 44,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
    },
    zoomDivider: {
        height: StyleSheet.hairlineWidth,
        backgroundColor: '#DCE4EE',
    },
    layerControlButton: {
        marginTop: 10,
    },
    bottomSheet: {
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: '#FFFFFF',
        borderTopLeftRadius: 30,
        borderTopRightRadius: 30,
        paddingTop: 4,
        paddingHorizontal: 20,
        shadowColor: '#091325',
        shadowOpacity: 0.22,
        shadowRadius: 18,
        shadowOffset: {width: 0, height: -6},
        elevation: 18,
    },
    sheetHandleTouch: {
        alignItems: 'center',
        justifyContent: 'center',
        height: 26,
    },
    sheetHandle: {
        width: 56,
        height: 7,
        borderRadius: 99,
        backgroundColor: '#D3DCE8',
    },
    summaryRow: {
        marginTop: 4,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    summaryTextBlock: {
        flex: 1,
        paddingRight: 8,
    },
    summaryTitle: {
        fontSize: 36,
        lineHeight: 40,
        color: '#111827',
        fontWeight: '700',
    },
    summaryDistance: {
        fontSize: 20,
        color: '#64748B',
        fontWeight: '700',
    },
    summarySubtitle: {
        marginTop: 2,
        fontSize: 18,
        color: '#64748B',
        fontWeight: '600',
    },
    primaryActionsRow: {
        marginTop: 16,
        marginBottom: 10,
        flexDirection: 'row',
        alignItems: 'center',
    },
    startNavigationButton: {
        flex: 1,
        backgroundColor: '#0B84FF',
        borderRadius: 28,
        height: 50,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: '#0B84FF',
        shadowOpacity: 0.35,
        shadowRadius: 11,
        shadowOffset: {width: 0, height: 6},
        elevation: 4,
    },
    disabledPrimaryButton: {
        opacity: 0.55,
    },
    startNavigationText: {
        color: '#FFFFFF',
        fontSize: 21,
        fontWeight: '700',
        marginLeft: 8,
    },
    shareButton: {
        width: 50,
        height: 50,
        borderRadius: 25,
        backgroundColor: '#EAF3FF',
        alignItems: 'center',
        justifyContent: 'center',
        marginLeft: 12,
    },
    locationToggleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 8,
    },
    locationToggleLabel: {
        color: '#1F2937',
        fontSize: 15,
        fontWeight: '600',
    },
    locationToggleHint: {
        color: '#64748B',
        fontSize: 12,
        marginBottom: 10,
    },
    optimizeError: {
        color: '#B91C1C',
        fontSize: 13,
        backgroundColor: '#FEF2F2',
        borderRadius: 10,
        paddingVertical: 7,
        paddingHorizontal: 10,
        marginBottom: 10,
    },
    sheetDivider: {
        height: StyleSheet.hairlineWidth,
        backgroundColor: '#E2E8F0',
        marginHorizontal: -20,
    },
    sheetExpandedArea: {
        flex: 1,
    },
    sheetExpandedContent: {
        paddingTop: 16,
        paddingBottom: 20,
    },
    routeStopsHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 14,
    },
    routeStopsTitle: {
        fontSize: 30,
        fontWeight: '700',
        color: '#111827',
    },
    optimizeButton: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#EEF5FF',
        borderRadius: 20,
        height: 38,
        paddingHorizontal: 12,
    },
    disabledOptimizeButton: {
        opacity: 0.5,
    },
    optimizeButtonText: {
        marginLeft: 6,
        color: '#0B84FF',
        fontSize: 14,
        fontWeight: '700',
    },
    emptyStopsText: {
        color: '#64748B',
        fontSize: 15,
        marginBottom: 12,
    },
    stopRow: {
        flexDirection: 'row',
        alignItems: 'center',
        height: 64,
    },
    dragIcon: {
        width: 14,
    },
    stopBadge: {
        width: 34,
        height: 34,
        borderRadius: 17,
        backgroundColor: '#1C8AFF',
        alignItems: 'center',
        justifyContent: 'center',
        marginHorizontal: 10,
    },
    stopBadgeText: {
        color: '#FFFFFF',
        fontSize: 16,
        fontWeight: '700',
    },
    stopValuePill: {
        flex: 1,
        height: 48,
        borderRadius: 14,
        backgroundColor: '#F1F5F9',
        justifyContent: 'center',
        paddingHorizontal: 14,
        marginRight: 12,
    },
    stopText: {
        color: '#1F2937',
        fontSize: 16,
        fontWeight: '600',
    },
    stopConnector: {
        marginLeft: 31,
        width: 2,
        height: 14,
        borderRadius: 2,
        backgroundColor: '#D2DBE7',
    },
    addStopButton: {
        marginTop: 8,
        marginBottom: 14,
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 6,
        paddingLeft: 38,
    },
    addStopText: {
        marginLeft: 8,
        color: '#0B84FF',
        fontSize: 20,
        fontWeight: '700',
    },
});
