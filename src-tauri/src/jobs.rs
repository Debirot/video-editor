//! Fila de tarefas em segundo plano, com prioridade, concorrência limitada e
//! deduplicação por chave (hash da mídia + tipo de tarefa).
//!
//! | Prioridade | Tarefas                               | Concorrência |
//! |------------|---------------------------------------|--------------|
//! | Alta       | ffprobe, pôster, miniaturas visíveis  | 4            |
//! | Média      | waveforms, folhas de miniaturas       | 2            |
//! | Baixa      | proxies, conversões                   | 1            |
//!
//! Não depende do Tauri: quem enfileira decide como avisar a interface (callback).
//! Cancelamento, pausa durante exportação e retomada de proxies entram com os proxies.

use std::collections::HashSet;
use std::future::Future;
use std::sync::{Arc, Mutex};

use tokio::sync::{OwnedSemaphorePermit, Semaphore};

// Média e Baixa entram com waveforms e proxies.
#[allow(dead_code)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Priority {
    High,
    Medium,
    Low,
}

pub struct JobQueue {
    high: Arc<Semaphore>,
    medium: Arc<Semaphore>,
    low: Arc<Semaphore>,
    active: Mutex<HashSet<String>>,
}

impl Default for JobQueue {
    fn default() -> Self {
        Self::with_limits(4, 2, 1)
    }
}

impl JobQueue {
    pub fn with_limits(high: usize, medium: usize, low: usize) -> Self {
        JobQueue {
            high: Arc::new(Semaphore::new(high)),
            medium: Arc::new(Semaphore::new(medium)),
            low: Arc::new(Semaphore::new(low)),
            active: Mutex::new(HashSet::new()),
        }
    }

    fn semaphore(&self, priority: Priority) -> Arc<Semaphore> {
        match priority {
            Priority::High => self.high.clone(),
            Priority::Medium => self.medium.clone(),
            Priority::Low => self.low.clone(),
        }
    }

    /// Espera uma vaga na prioridade. Para trabalho que a chamada aguarda (ex.: ffprobe na importação).
    pub async fn acquire(&self, priority: Priority) -> OwnedSemaphorePermit {
        self.semaphore(priority)
            .acquire_owned()
            .await
            .expect("semáforo nunca é fechado")
    }

    pub fn is_active(&self, key: &str) -> bool {
        self.active.lock().unwrap().contains(key)
    }

    /// Enfileira `task` em segundo plano. Devolve false (e não faz nada) se a mesma
    /// chave já estiver na fila ou rodando. `on_done` recebe o resultado.
    pub fn spawn<Fut, Done>(
        self: &Arc<Self>,
        key: String,
        priority: Priority,
        task: Fut,
        on_done: Done,
    ) -> bool
    where
        Fut: Future<Output = Result<(), String>> + Send + 'static,
        Done: FnOnce(Result<(), String>) + Send + 'static,
    {
        if !self.active.lock().unwrap().insert(key.clone()) {
            return false;
        }
        let queue = Arc::clone(self);
        let semaphore = self.semaphore(priority);
        tokio::spawn(async move {
            let result = {
                let _permit = semaphore
                    .acquire_owned()
                    .await
                    .expect("semáforo nunca é fechado");
                task.await
            };
            queue.active.lock().unwrap().remove(&key);
            on_done(result);
        });
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::time::Duration;
    use tokio::sync::mpsc;

    #[tokio::test]
    async fn dedups_by_key_until_done() {
        let q = Arc::new(JobQueue::default());
        let (tx, mut rx) = mpsc::unbounded_channel();
        let (release_tx, release_rx) = tokio::sync::oneshot::channel::<()>();

        let tx1 = tx.clone();
        assert!(q.spawn(
            "poster:a".into(),
            Priority::High,
            async move {
                release_rx.await.ok();
                Ok(())
            },
            move |r| tx1.send(r).unwrap()
        ));
        assert!(q.is_active("poster:a"));
        assert!(!q.spawn(
            "poster:a".into(),
            Priority::High,
            async { Ok(()) },
            |_| panic!("duplicada")
        ));

        release_tx.send(()).unwrap();
        assert_eq!(rx.recv().await.unwrap(), Ok(()));
        assert!(!q.is_active("poster:a"));

        // Depois de concluída, a mesma chave pode rodar de novo.
        let tx2 = tx.clone();
        assert!(q.spawn(
            "poster:a".into(),
            Priority::High,
            async { Err("falhou".into()) },
            move |r| tx2.send(r).unwrap()
        ));
        assert_eq!(rx.recv().await.unwrap(), Err("falhou".to_string()));
    }

    #[tokio::test]
    async fn respects_concurrency_per_priority() {
        let q = Arc::new(JobQueue::with_limits(2, 1, 1));
        let running = Arc::new(AtomicUsize::new(0));
        let peak = Arc::new(AtomicUsize::new(0));
        let (tx, mut rx) = mpsc::unbounded_channel();
        for i in 0..6 {
            let (running, peak, tx) = (running.clone(), peak.clone(), tx.clone());
            q.spawn(
                format!("job:{i}"),
                Priority::High,
                async move {
                    let now = running.fetch_add(1, Ordering::SeqCst) + 1;
                    peak.fetch_max(now, Ordering::SeqCst);
                    tokio::time::sleep(Duration::from_millis(20)).await;
                    running.fetch_sub(1, Ordering::SeqCst);
                    Ok(())
                },
                move |_| tx.send(()).unwrap(),
            );
        }
        for _ in 0..6 {
            rx.recv().await.unwrap();
        }
        assert_eq!(peak.load(Ordering::SeqCst), 2);
    }

    #[tokio::test]
    async fn acquire_blocks_when_full() {
        let q = JobQueue::with_limits(1, 1, 1);
        let permit = q.acquire(Priority::Low).await;
        assert!(
            tokio::time::timeout(Duration::from_millis(30), q.acquire(Priority::Low))
                .await
                .is_err()
        );
        drop(permit);
        assert!(
            tokio::time::timeout(Duration::from_millis(30), q.acquire(Priority::Low))
                .await
                .is_ok()
        );
    }
}
