export type ComputeCellViewModel = {
  balance: number | null;
  detail: string;
  label: string;
  shortage: number;
  target: number;
};

export function ComputeCell({ cell }: { cell: ComputeCellViewModel }) {
  const available = Math.max(0, cell.balance ?? 0);
  const meteredBalance = Math.min(available, cell.target);
  const hasFundingGap = cell.shortage > 0;

  return (
    <aside className="energy-panel" aria-label="Compute Energy balance">
      <div className="energy-topline">
        <span>COMPUTE CELL</span>
        <span className="energy-state">{cell.label}</span>
      </div>

      <div className="energy-dashboard">
        <div className="energy-orbit" aria-hidden="true">
          <span className="energy-core">
            <strong>{cell.balance ?? "—"}</strong>
            <small>CE</small>
          </span>
        </div>

        <div className="energy-readout">
          <span className="energy-readout-label">AVAILABLE BALANCE</span>
          <div className="energy-total">
            <strong>{cell.balance ?? "—"}</strong>
            <span>/ {cell.target} CE</span>
          </div>
          <progress
            aria-label={`${meteredBalance} of ${cell.target} Compute Energy available`}
            max={cell.target}
            value={meteredBalance}
          >
            {meteredBalance} of {cell.target} CE
          </progress>
          <div className="energy-meter-labels" aria-hidden="true">
            <span>{meteredBalance} CE FUNDED</span>
            <span>{hasFundingGap ? `${cell.shortage} CE NEEDED` : "READY"}</span>
          </div>
        </div>
      </div>

      {hasFundingGap ? (
        <div className="energy-equation" aria-label={`${available} CE available plus ${cell.shortage} CE Sponsor Quest reward equals ${cell.target} CE task cost`}>
          <span><small>AVAILABLE</small><strong>{available} CE</strong></span>
          <b aria-hidden="true">+</b>
          <span><small>SPONSOR QUEST</small><strong>+{cell.shortage} CE</strong></span>
          <b aria-hidden="true">=</b>
          <span><small>TASK COST</small><strong>{cell.target} CE</strong></span>
        </div>
      ) : null}

      <p className="energy-detail">{cell.detail}</p>
    </aside>
  );
}
