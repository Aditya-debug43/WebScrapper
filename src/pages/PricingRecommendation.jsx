import { useOutletContext } from "react-router-dom";
import { useAsyncData } from "../utils/useAsyncData";
import { getRecommendation } from "../api/recommendationService";
import RecommendationPanel from "../components/recommendation/RecommendationPanel";
import LoadingState from "../components/common/LoadingState";
import "./PricingRecommendation.css";

export default function PricingRecommendation() {
  const { productId } = useOutletContext();
  const { data: rec, loading } = useAsyncData(() => getRecommendation(productId), [productId]);

  if (loading || !rec) return <LoadingState label="Building recommendation…" />;

  return <RecommendationPanel rec={rec} />;
}
