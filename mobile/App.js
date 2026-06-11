import "react-native-gesture-handler";
import "react-native-url-polyfill/auto";
import { NavigationContainer, DarkTheme } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { StatusBar } from "expo-status-bar";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { AuthProvider, useAuth } from "./src/context/AuthContext";
import { ProgressProvider } from "./src/context/ProgressContext";
import { colors, globalStyles } from "./src/theme";
import LoginScreen from "./src/screens/LoginScreen";
import SignupScreen from "./src/screens/SignupScreen";
import HomeScreen from "./src/screens/HomeScreen";
import VocabularyScreen from "./src/screens/VocabularyScreen";
import ReadingScreen from "./src/screens/ReadingScreen";
import ListeningScreen from "./src/screens/ListeningScreen";
import TutorScreen from "./src/screens/TutorScreen";
import DashboardScreen from "./src/screens/DashboardScreen";
import FlashcardsScreen from "./src/screens/FlashcardsScreen";
import ExercisesScreen from "./src/screens/ExercisesScreen";
import ExamScreen from "./src/screens/ExamScreen";
import GrammarScreen from "./src/screens/GrammarScreen";
import PlansScreen from "./src/screens/PlansScreen";
import SettingsScreen from "./src/screens/SettingsScreen";

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

const navTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: colors.background,
    card: colors.panel,
    text: colors.text,
    border: colors.border,
    primary: colors.gold
  }
};

function TabLabel({ focused, label }) {
  return <Text style={[globalStyles.tabLabel, focused && globalStyles.tabLabelActive]}>{label}</Text>;
}

function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: globalStyles.tabBar,
        tabBarIconStyle: { display: "none" },
        tabBarLabel: ({ focused, children }) => <TabLabel focused={focused} label={children} />
      }}
    >
      <Tab.Screen name="Vocabulary" component={VocabularyScreen} />
      <Tab.Screen name="Reading" component={ReadingScreen} />
      <Tab.Screen name="Listening" component={ListeningScreen} />
      <Tab.Screen name="AI Tutor" component={TutorScreen} />
      <Tab.Screen name="Dashboard" component={DashboardScreen} />
    </Tab.Navigator>
  );
}

function HeaderButton() {
  const { signOut } = useAuth();
  return (
    <Pressable
      onPress={signOut}
      style={globalStyles.headerButton}
    >
      <Text style={globalStyles.headerButtonText}>Logout</Text>
    </Pressable>
  );
}

function AppStack() {
  return (
    <ProgressProvider>
      <Stack.Navigator
        screenOptions={() => ({
          headerStyle: { backgroundColor: colors.panel },
          headerTintColor: colors.gold,
          headerTitleStyle: { fontWeight: "800" },
          contentStyle: { backgroundColor: colors.background },
          headerRight: () => <HeaderButton />
        })}
      >
        <Stack.Screen name="Home" component={HomeScreen} />
        <Stack.Screen name="Learn" component={MainTabs} options={{ headerShown: false }} />
        <Stack.Screen name="Flashcards" component={FlashcardsScreen} />
        <Stack.Screen name="Exercises" component={ExercisesScreen} />
        <Stack.Screen name="Exam" component={ExamScreen} />
        <Stack.Screen name="Grammar" component={GrammarScreen} />
        <Stack.Screen name="Plans" component={PlansScreen} />
        <Stack.Screen name="Settings" component={SettingsScreen} />
      </Stack.Navigator>
    </ProgressProvider>
  );
}

function AuthStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.panel },
        headerTintColor: colors.gold,
        contentStyle: { backgroundColor: colors.background }
      }}
    >
      <Stack.Screen name="Login" component={LoginScreen} />
      <Stack.Screen name="Sign up" component={SignupScreen} />
    </Stack.Navigator>
  );
}

function RootNavigator() {
  const { session, loading } = useAuth();

  if (loading) {
    return (
      <View style={globalStyles.centered}>
        <ActivityIndicator color={colors.gold} />
        <Text style={globalStyles.muted}>Connecting to HanZi AI...</Text>
      </View>
    );
  }

  return <NavigationContainer theme={navTheme}>{session ? <AppStack /> : <AuthStack />}</NavigationContainer>;
}

export default function App() {
  return (
    <AuthProvider>
      <StatusBar style="light" />
      <RootNavigator />
    </AuthProvider>
  );
}
