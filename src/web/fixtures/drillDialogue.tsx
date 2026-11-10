import { useState } from "react";
import type { DrillPrompt, DrillTurn } from "../../shared/drills";
import { Button } from "../components/ui";
import { ArrowLeftIcon } from "../components/icons";
import { ConversationView, PromptView } from "../pages/DrillPage";

const PROMPT: DrillPrompt = {
  drill: "tradeoff",
  title: "Defend a trade-off",
  minutes: 15,
  task: 'The topic is "Fan-out strategy". Say what you would choose for this problem, give the reason from its requirements, and say what would make you choose differently.',
  topic: "Fan-out strategy",
  problem: { id: "c2-news-feed", title: "News Feed", track: "hld" },
  material: [
    { heading: "The problem", markdown: "Design a news feed. Each user follows other users and reads a ranked list of their newest posts." },
    { heading: "The topic", markdown: "Fan-out strategy" },
  ],
  answerHint: "Take a side and give the reason from this problem's needs. Expect a question that pushes back.",
};

const TURNS: DrillTurn[] = [
  {
    role: "candidate",
    text: "I would fan out on write for most users. A timeline read must be fast, and reads outnumber posts by a large factor.\nFor an account with millions of followers I would skip the push and merge its posts when the reader opens the feed.",
  },
  { role: "grader", text: "What does that merge cost on every read of the feed?" },
];

/** A dialogue drill after the first question: the prompt on the left, the thread and the reply box on the right. */
export function DrillDialogueFixture() {
  const [reply, setReply] = useState("");
  return (
    <div className="page-canvas flex h-full min-h-0 flex-col overflow-y-auto">
      <header className="sticky top-0 z-20 shrink-0 border-b border-border/70 bg-card/90">
        <div className="mx-auto flex h-14 max-w-[1224px] items-center gap-4 px-4 sm:px-8">
          <Button variant="ghost" size="sm">
            <ArrowLeftIcon size={14} />
            Practice
          </Button>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[1224px] flex-1 px-4 pb-16 pt-8 sm:px-8">
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <PromptView prompt={PROMPT} />
          <ConversationView
            conversation={{ attemptId: "a1b2c3d4e5f60099", turns: TURNS, asked: 1, of: 2 }}
            reply={reply}
            onReply={setReply}
            busy={false}
            error={null}
            onSend={() => undefined}
            onStartOver={() => undefined}
          />
        </div>
      </main>
    </div>
  );
}
