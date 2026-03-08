import styles from "./Bubble.module.css";

export default function Bubble({ point }) {

    const co2Avoided = point?.infos?.[0]?.co2 ?? 0;

    const size = Math.max(100, co2Avoided * 0.25);

    return (
        <div
            className={styles.wrapper}
            style={{
                width: `${size}px`,
                height: `${size}px`
            }}
        >
            <div className={styles.glow}></div>

            <div className={styles.bubble}>
                <img
                    className={styles.icon}
                    src="../../public/particle.png"
                />

                <div className={styles.header}>
                    <span>CO₂</span>
                </div>

                <div className={styles.value}>
                    {co2Avoided}
                </div>

                <div className={styles.unit}>
                    kg avoided
                </div>
            </div>
        </div>
    );
}