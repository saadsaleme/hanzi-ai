import { useState } from "react";
import { Alert, Pressable, Text, TextInput, View } from "react-native";
import { getSupabaseConfigStatus } from "../lib/supabase";
import { colors, globalStyles } from "../theme";
import { useAuth } from "../context/AuthContext";

export default function LoginScreen({ navigation }) {
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const config = getSupabaseConfigStatus();

  async function handleLogin() {
    try {
      setLoading(true);
      await signIn(email.trim(), password);
    } catch (error) {
      Alert.alert("Login failed", error.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={globalStyles.screen}>
      <Text style={globalStyles.title}>HanZi AI</Text>
      <Text style={globalStyles.muted}>Sign in with the same account you use on the website.</Text>
      {!config.hasUrl || !config.hasAnonKey ? (
        <View style={globalStyles.card}>
          <Text style={[globalStyles.text, { color: colors.danger }]}>
            Add EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY to mobile/.env.
          </Text>
        </View>
      ) : null}
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
      <Pressable style={globalStyles.button} onPress={handleLogin} disabled={loading}>
        <Text style={globalStyles.buttonText}>{loading ? "Signing in..." : "Log In"}</Text>
      </Pressable>
      <Pressable style={globalStyles.ghostButton} onPress={() => navigation.navigate("Sign up")}>
        <Text style={globalStyles.ghostText}>Create Account</Text>
      </Pressable>
    </View>
  );
}
