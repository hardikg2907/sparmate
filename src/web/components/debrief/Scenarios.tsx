import type { Scorecard } from "../../../shared/types";
import { CheckIcon, CrossIcon } from "../icons";
import { Card, Badge } from "../ui";
import { sharedCauses } from "../../lib/scenarios";

export function ScenarioTable({ scorecard }: { scorecard: Scorecard }) {
  const scenarios = scorecard.lldScenarios;
  if (scenarios.length === 0) return null;
  const passed = scenarios.filter((scenario) => scenario.pass).length;
  const shared = sharedCauses(scenarios);
  return (
    <section id="scenarios" aria-labelledby="scenarios-heading">
      <h3 id="scenarios-heading" className="mb-2 text-body font-semibold text-foreground">
        Demo scenarios{" "}
        <span className="text-ui font-normal text-muted-foreground">
          {passed} of {scenarios.length} pass
        </span>
      </h3>
      {shared.length > 0 ? (
        <ul className="mb-2 space-y-1 text-ui leading-snug text-foreground">
          {shared.map((group) => (
            <li key={group.cause}>
              {group.names.length} of {scenarios.length} scenarios fail for one cause: {group.cause}. <span className="text-muted-foreground">({group.names.join("; ")})</span>
            </li>
          ))}
        </ul>
      ) : null}
      <Card variant="raised" className="overflow-hidden">
        <table className="w-full border-collapse text-left">
          <thead className="bg-muted text-ui font-semibold text-muted-foreground">
            <tr>
              <th scope="col" className="px-4 py-2.5">
                Scenario
              </th>
              <th scope="col" className="w-24 px-4 py-2.5">
                Result
              </th>
              <th scope="col" className="px-4 py-2.5">
                Detail
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {scenarios.map((scenario) => (
              <tr key={scenario.name} className="align-top">
                <th scope="row" className="px-4 py-3 text-ui font-medium">
                  {scenario.name}
                </th>
                <td className="px-4 py-3">
                  {scenario.pass ? (
                    <Badge tone="good">
                      <CheckIcon size={12} />
                      Pass
                    </Badge>
                  ) : (
                    <Badge tone="bad">
                      <CrossIcon size={12} />
                      Fail
                    </Badge>
                  )}
                </td>
                <td className="px-4 py-3 text-ui leading-snug text-muted-foreground">{scenario.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </section>
  );
}
