import {renderSparkline as renderSharedSparkline} from "../../../ui-library/components/charts/sparkline.ts";
import {digestLanguage} from "../../i18n.ts";
export const renderSparkline=(values:readonly (number|null)[],label:string):string=>renderSharedSparkline(values,label,digestLanguage());
