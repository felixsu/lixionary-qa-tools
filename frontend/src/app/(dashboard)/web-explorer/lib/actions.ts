// Element action vocabulary shared by the inspector card and selector tester.
export const ACTION_OPTIONS = [
  { value: "click", label: "Click" },
  { value: "fill", label: "Fill" },
  { value: "type", label: "Type" },
  { value: "hover", label: "Hover" },
  { value: "check", label: "Check" },
  { value: "select_option", label: "Select option" },
  { value: "getText", label: "Get Text" },
];

/** Actions that take a value argument (shows the test-value input). */
export const VALUE_ACTIONS = ["fill", "type", "select_option"];
