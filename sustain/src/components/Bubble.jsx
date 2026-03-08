import styles from "./Bubble.module.css";

export default function Bubble({ point }) {

    const co2Avoided = point?.infos?.[0]?.co2 ?? 0;

    const size = Math.max(60, co2Avoided * 0.17);

    return (
        <div className={styles.bubble}
             style={{
                 width: `${size}px`,
                 height: `${size}px`
             }}>
            <div className={styles.icon}>🌱</div>
            <div className={styles.value}>
                {co2Avoided} kg
            </div>
        </div>
    );
}