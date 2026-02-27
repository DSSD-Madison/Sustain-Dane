import {TraceMap} from "@/components/TraceMap.jsx";
import styles from "./MapBox.module.css";


export function MapBox() {
    return(
        <div className={styles.mapAll}>
            <TraceMap></TraceMap>
        </div>
    )
}