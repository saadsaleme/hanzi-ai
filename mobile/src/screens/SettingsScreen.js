import { useState } from "react";
import { Alert, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { supabase } from "../lib/supabase";
import { useAuth } from "../context/AuthContext";
import { colors, globalStyles } from "../theme";

export default function SettingsScreen() {
  const { user, profile } = useAuth();
  const [fullName, setFullName] = useState(profile?.full_name || "");
  const [preferredVoice, setPreferredVoice] = useState(profile?.preferred_voice || "zh-CN");

  async function saveSettings() {
    if (!supabase || !user) return;
    const { error } = await supabase
      .from("profiles")
      .upsert(
        {
          id: user.id,
          email: user.email,
          full_name: fullName,
          preferred_voice: preferredVoice,
          updated_at: new Date().toISOString()
        },
        { onConflict: "id" }
      );

    if (error) {
      Alert.alert("Settings failed", error.message);
    } else {
      Alert.alert("Saved", "Mobile settings saved to Supabase.");
    }
  }

  return (
    <ScrollView style={globalStyles.screen}>
      <Text style={globalStyles.title}>Settings</Text>
      <View style={globalStyles.card}>
        <Text style={globalStyles.subheading}>Profile</Text>
        <TextInput
          placeholder="Full name"
          placeholderTextColor={colors.muted}
          style={globalStyles.input}
          value={fullName}
          onChangeText={setFullName}
        />
        <TextInput
          placeholder="Preferred voice"
          placeholderTextColor={colors.muted}
          style={globalStyles.input}
          value={preferredVoice}
          onChangeText={setPreferredVoice}
        />
        <Pressable style={globalStyles.button} onPress={saveSettings}>
          <Text style={globalStyles.buttonText}>Save Settings</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}
