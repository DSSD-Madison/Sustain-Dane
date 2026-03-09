import styles from "./HeatBublle.module.css";

export default function HeatBubble({ point }) {

    const co2Avoided = point?.infos?.[0]?.co2 ?? 0;

    const size = Math.max(120, co2Avoided * 0.6);

    return (
        <div
            className={styles.heat}
            style={{
                width: `${size}px`,
                height: `${size}px`
            }}
        />
    );
}