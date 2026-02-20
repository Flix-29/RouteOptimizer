import FontAwesome from '@expo/vector-icons/FontAwesome';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import Mapbox, {Camera, LocationPuck, MapView} from '@rnmapbox/maps';
import {useEffect, useMemo, useRef, useState} from 'react';
import {
    ActivityIndicator,
    FlatList,
    Platform,
    Pressable,
    ScrollView,
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

interface Stop {
    id: string;
    title: string;
}

const stops: Stop[] = [
    {id: '1', title: '123 Main St, San Francisco, CA'},
    {id: '2', title: '456 Market St, San Francisco, CA'},
    {id: '3', title: '789 Broadway, San Francisco, CA'},
]

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

    const [isSheetOpen, setIsSheetOpen] = useState(false);

    const cameraRef = useRef<Camera>(null);

    const expandedSheetHeight = useMemo(
        () => Math.min(screenHeight * 0.74, 620),
        [screenHeight],
    );
    const sheetHeight = isSheetOpen ? expandedSheetHeight : 190;

    const centerCamera = (longitude: number, latitude: number, nextZoom = 14) => {
        setZoomLevel(nextZoom);
        cameraRef.current?.setCamera({
            centerCoordinate: [longitude, latitude],
            zoomLevel: nextZoom,
            animationDuration: 700,
        });
    };

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

        checkPermission();

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

                const data = await response.json() as { features?: GeocodingFeature[] };
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
        setFollowUserLocation(false);
        setSearchResults([]);
        setSearchError(null);
        centerCamera(longitude, latitude, 14);
        setSearchQuery(
            result.properties?.full_address
            ?? result.place_formatted
            ?? result.place_name
            ?? result.properties?.name
            ?? result.text
            ?? '',
        );
    };

    const toggleMapStyle = () => {
        setIsSatellite((previous) => !previous);
    };

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
                            XX min <Text style={styles.summaryDistance}>(XX km)</Text>
                        </Text>
                        <Text style={styles.summarySubtitle}>summary</Text>
                    </View>
                </View>

                <View style={styles.primaryActionsRow}>
                    <Pressable style={styles.startNavigationButton}>
                        <FontAwesome name="location-arrow" size={20} color="#FFFFFF"/>
                        <Text style={styles.startNavigationText}>Start Navigation</Text>
                    </Pressable>
                    <Pressable style={styles.shareButton}>
                        <FontAwesome name="share-alt" size={20} color="#0B84FF"/>
                    </Pressable>
                </View>

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
                                <Pressable style={styles.optimizeButton}>
                                    <FontAwesome name="magic" size={13} color="#0B84FF"/>
                                    <Text style={styles.optimizeButtonText}>Optimize Route</Text>
                                </Pressable>
                            </View>

                            {stops.map((stop, index) => (
                                <View key={stop.id}>
                                    <View style={styles.stopRow}>
                                        <FontAwesome name="ellipsis-v" size={19} color="#94A3B8"
                                                     style={styles.dragIcon}/>
                                        <View style={styles.stopBadge}>
                                            <Text style={styles.stopBadgeText}>{index + 1}</Text>
                                        </View>
                                        <View style={styles.stopValuePill}>
                                            <Text style={styles.stopText} numberOfLines={1}>
                                                {stop.title}
                                            </Text>
                                        </View>
                                        <Pressable hitSlop={8}>
                                            <FontAwesome name="times" size={18} color="#CBD5E1"/>
                                        </Pressable>
                                    </View>
                                    {index < stops.length - 1 && <View style={styles.stopConnector}/>}
                                </View>
                            ))}

                            <Pressable style={styles.addStopButton}>
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
        fontSize: 20,
        color: '#64748B',
        fontWeight: '600',
    },
    tagGroup: {
        flexDirection: 'row',
    },
    routeTag: {
        width: 24,
        height: 24,
        borderRadius: 12,
        backgroundColor: '#E8F2FF',
        alignItems: 'center',
        justifyContent: 'center',
        marginLeft: 6,
    },
    routeTagText: {
        color: '#0B84FF',
        fontSize: 12,
        fontWeight: '700',
    },
    primaryActionsRow: {
        marginTop: 16,
        marginBottom: 14,
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
    optimizeButtonText: {
        marginLeft: 6,
        color: '#0B84FF',
        fontSize: 14,
        fontWeight: '700',
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
    chargingRow: {
        marginTop: 14,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    chargingTextRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    chargingText: {
        marginLeft: 10,
        fontSize: 22,
        color: '#475569',
        fontWeight: '600',
    },
});
