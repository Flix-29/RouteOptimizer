import {View} from "react-native";
import {MapView} from '@rnmapbox/maps';

export default function Index() {
    return (
        <View
            style={{
                flex: 1,
                justifyContent: "center",
                alignItems: "center",
            }}
        >
            <MapView/>
        </View>
    );
}
