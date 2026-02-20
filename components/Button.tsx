import * as React from "react";
import {Pressable, type ViewStyle} from "react-native";

interface buttonProps {
    onPress: () => void;
    children: React.ReactNode;
}

const buttonStyle: ViewStyle = {
    backgroundColor: "#f3f3f3",
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
};

function Button({onPress, children}: buttonProps) {
    return (
        <Pressable
            onPress={onPress}
            accessibilityRole="button"
            style={buttonStyle}
        >
            {children}
        </Pressable>
    );
}

export {Button}
