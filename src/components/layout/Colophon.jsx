import { Link } from "react-router-dom";
import "./Colophon.css";

/**
 * The provenance statement, moved out of the old sidebar card and given a
 * footer of its own. It belongs to the whole application rather than to one
 * panel of navigation, and a reader deserves to find it in the place a
 * publication would put its colophon.
 */
export default function Colophon() {
  return (
    <footer className="colophon">
      <div className="colophon-inner">
        <div className="colophon-block">
          <span className="eyebrow">Data</span>
          <p>
            Simulated marketplace data — realistic in structure, not captured from the live platforms. Every figure
            in this prototype is computed from it. <Link to="/sources">See coverage and provenance</Link>.
          </p>
        </div>
        <div className="colophon-block">
          <span className="eyebrow">Build</span>
          <p>
            Mock service layer in the browser today; a Node/TypeScript API over PostgreSQL is being built behind the
            same boundary, so the screens do not change when the source does.
          </p>
        </div>
        <div className="colophon-block">
          <span className="eyebrow">Basis</span>
          <p>
            Prices compare on the <strong>effective price</strong> — what any buyer pays, with no card, coupon or
            trade-in.
          </p>
        </div>
      </div>
    </footer>
  );
}
