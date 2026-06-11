import { useState } from "react";
import { Alert, Pressable, Text, TextInput, View } from "react-native";
import { colors, globalStyles } from "../theme";
import { useAuth } from "../context/AuthContext";

export default function SignupScreen({ navigation }) {
  const { signUp } = useAuth();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSignup() {
    if (!fullName.trim() || !email.trim() || password.length < 6) {
      Alert.alert("Check details", "Enter your name, email, and a password with at least 6 characters.");
      return;
    }

    try {
      setLoading(true);
      await signUp({ fullName: fullName.trim(), email: email.trim(), password });
      navigation.replace("Login");
    } catch (error) {
      Alert.alert("Sign up failed", error.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={globalStyles.screen}>
      <Text style={globalStyles.title}>Create Account</Text>
      <Text style={globalStyles.muted}>Your mobile account syncs with HanZi AI on the web.</Text>
      <TextInput
        placeholder="Full name"
        placeholderTextColor={colors.muted}
        style={globalStyles.input}
        value={fullName}
        onChangeText={setFullName}
      />
      <TextInput
        autoCapitalize="none"
        keyboardType="email-address"
        placeholder="Email"
        placeholderTextColor={colors.muted}
        style={globalStyles.input}
        value={email}
        onChangeText={setEmail}
      />
      <TextInput
        placeholder="Password"
        placeholderTextColor={colors.muted}
        secureTextEntry
        style={globalStyles.input}
        value={password}
        onChangeText={setPassword}
      />
      <Pressable style={globalStyles.button} onPress={handleSignup} disabled={loading}>
        <Text style={globalStyles.buttonText}>{loading ? "Creating..." : "Sign Up"}</Text>
      </Pressable>
    </View>
  );
}
