import { renderChart as renderSharedChart } from "../../../ui-library/components/charts/render.ts";
import type { ChartInput, ChartSpec } from "./model.ts";
import { digestLanguage } from "../../i18n.ts";

export const renderChart=(spec:ChartSpec):string=>renderSharedChart(spec,digestLanguage());
export const renderTrendChart=(input:ChartInput):string=>renderChart({...input,version:1,kind:"trend"});
export const renderBarChart=(input:ChartInput):string=>renderChart({...input,version:1,kind:"bar"});
