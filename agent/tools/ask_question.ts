import { askQuestion } from "eve/tools/ask_question";

// Eve 0.65 made ask_question opt-in; the instructions and Slack question cards rely on it.
export default askQuestion();
