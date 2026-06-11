import { StyleSheet } from "react-native";
import { colors } from "./theme/colors";

export { colors };

export const globalStyles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
    padding: 18
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.background,
    padding: 24
  },
  title: {
    color: colors.gold,
    fontSize: 30,
    fontWeight: "900",
    marginBottom: 8
  },
  heading: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "800",
    marginBottom: 10
  },
  subheading: {
    color: colors.gold,
    fontSize: 17,
    fontWeight: "800",
    marginBottom: 8
  },
  text: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 22
  },
  muted: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 21,
    marginTop: 8
  },
  card: {
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
    marginBottom: 14
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10
  },
  input: {
    backgroundColor: colors.panelSoft,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    color: colors.text,
    paddingHorizontal: 14,
    paddingVertical: 13,
    marginBottom: 12,
    fontSize: 15
  },
  button: {
    backgroundColor: colors.gold,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 13,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8
  },
  buttonText: {
    color: colors.background,
    fontWeight: "900",
    fontSize: 15
  },
  ghostButton: {
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    alignItems: "center",
    marginTop: 8
  },
  ghostText: {
    color: colors.text,
    fontWeight: "800"
  },
  pill: {
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7
  },
  pillText: {
    color: colors.gold,
    fontSize: 12,
    fontWeight: "800"
  },
  tabBar: {
    backgroundColor: colors.panel,
    borderTopColor: colors.border,
    minHeight: 66,
    paddingTop: 8
  },
  tabLabel: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "800",
    paddingBottom: 10
  },
  tabLabelActive: {
    color: colors.gold
  },
  headerButton: {
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6
  },
  headerButtonText: {
    color: colors.gold,
    fontWeight: "800",
    fontSize: 12
  }
});
