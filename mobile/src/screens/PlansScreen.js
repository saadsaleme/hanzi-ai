import { ScrollView, Text, View } from "react-native";
import { useProgress } from "../context/ProgressContext";
import { globalStyles } from "../theme";

export default function PlansScreen() {
  const { subscription } = useProgress();

  return (
    <ScrollView style={globalStyles.screen}>
      <Text style={globalStyles.title}>Plans</Text>
      <View style={globalStyles.card}>
        <Text style={globalStyles.subheading}>Current Plan</Text>
        <Text style={globalStyles.text}>{subscription?.plan_name || subscription?.plan || "Free Trial"}</Text>
        <Text style={globalStyles.muted}>Subscription rules should be enforced by Supabase policies and shared entitlement rows.</Text>
      </View>
      {["Free Trial", "Monthly", "Annual", "Lifetime"].map((plan) => (
        <View key={plan} style={globalStyles.card}>
          <Text style={globalStyles.heading}>{plan}</Text>
          <Text style={globalStyles.muted}>Uses the same payment and entitlement data as the website.</Text>
        </View>
      ))}
    </ScrollView>
  );
}
