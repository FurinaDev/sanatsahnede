import React, { useEffect, useState } from 'react';
import { apiRequest } from '../../services/api';
import { Booking, DigitalContract, DisputeRecord, FinancialLedgerEntry } from '../../types';
import { BookingReceiptSummary, formatCurrencyTRY } from '../../utils/businessLogic';
import {
  X,
  Printer,
  ShieldCheck,
  FileText,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Receipt,
  Building2,
  UserCheck,
} from 'lucide-react';

interface ReceiptPayload {
  booking: Booking;
  businessInfo: {
    id: string;
    businessName: string;
    officialTitle: string;
    taxOffice: string;
    taxNumber: string;
    city: string;
    district: string;
  } | null;
  contract: DigitalContract | null;
  ledgerEntries: FinancialLedgerEntry[];
  dispute: DisputeRecord | null;
  summary: BookingReceiptSummary;
  verificationCode: string;
}

interface Props {
  bookingId: string | null;
  onClose: () => void;
}

const LEDGER_LABELS: Record<string, string> = {
  payment_hold: 'Güvence Havuzu Blokesi',
  commission_accrual: 'Platform Hizmet Komisyonu',
  payout_release: 'İcracı Hakediş Aktarımı',
  refund: 'Tam İade',
  partial_refund: 'Kısmi İade',
  adjustment: 'Mutabakat Düzeltmesi',
};

export const BookingReceiptModal: React.FC<Props> = ({ bookingId, onClose }) => {
  const [data, setData] = useState<ReceiptPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!bookingId) {
      setData(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiRequest<ReceiptPayload>(`/api/bookings/${bookingId}/receipt`)
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err: any) => {
        if (!cancelled) setError(err?.message || 'Sözleşme ve güvence dekontu yüklenemedi.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [bookingId]);

  if (!bookingId) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/70 flex items-center justify-center p-3 sm:p-5 overflow-y-auto print-receipt-overlay"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Dijital Sözleşme ve Güvence Dekontu"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white dark:bg-[#13213e] rounded-3xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-5 sm:p-7 text-left shadow-2xl border border-[#e2e8f0] dark:border-[#1e335a] space-y-5 print-receipt-sheet"
      >
        {/* Top Action Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-[#e2e8f0] dark:border-[#1e335a]">
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <div className="w-9 h-9 rounded-xl bg-[#f25922]/15 text-[#f25922] flex items-center justify-center shrink-0">
              <Receipt className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h3 className="font-display text-sm sm:text-base font-bold text-[#0f172a] dark:text-white leading-snug">
                Dijital İcra Sözleşmesi &amp; Güvence Dekontu
              </h3>
              <p className="text-[11px] text-[#64748b] dark:text-slate-400">
                SanatSahnede Denetlenebilir Escrow ve Sözleşme Kaydı
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0 self-end sm:self-center no-print">
            {data && (
              <button
                type="button"
                onClick={() => window.print()}
                className="px-3.5 py-2 rounded-xl bg-[#16274e] dark:bg-[#f25922] text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer hover:opacity-90 transition-opacity whitespace-nowrap"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>Yazdır / PDF Kaydet</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Dekontu Kapat"
              className="p-2 rounded-xl text-[#64748b] hover:text-[#0f172a] dark:hover:text-white hover:bg-slate-100 dark:hover:bg-[#0f1c38] cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {loading ? (
          <div className="py-12 text-center text-xs text-[#64748b] dark:text-slate-400">
            Sözleşme ve finansal kayıtlar doğrulanıyor...
          </div>
        ) : error ? (
          <div className="p-4 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-xs text-rose-800 dark:text-rose-200">
            {error}
          </div>
        ) : data ? (
          <div className="space-y-5">
            {/* Verification & Status Strip */}
            <div className="p-3.5 rounded-2xl bg-[#f8fafc] dark:bg-[#0f1c38] border border-[#e2e8f0] dark:border-[#1e335a] flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-0.5">
                <div className="text-[10px] font-bold uppercase tracking-wider text-[#64748b] dark:text-slate-400">
                  Doğrulama Kodu
                </div>
                <div className="font-mono text-xs font-extrabold text-[#16274e] dark:text-[#ffb59e]">
                  {data.verificationCode}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="px-2.5 py-1 rounded-lg bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 text-[11px] font-bold">
                  {data.summary.paymentStatusLabel}
                </span>
                <span className="px-2.5 py-1 rounded-lg bg-[#16274e]/10 dark:bg-white/10 text-[#16274e] dark:text-white text-[11px] font-bold">
                  {data.summary.bookingStatusLabel}
                </span>
              </div>
            </div>

            {/* Dispute Warning if any */}
            {data.dispute && (
              <div className="p-3.5 rounded-2xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 flex items-start gap-2.5 text-xs text-rose-900 dark:text-rose-200">
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <div>
                  <strong>Uyuşmazlık Kaydı ({data.dispute.status}):</strong> {data.dispute.reason}
                  {data.dispute.resolutionNote && (
                    <div className="mt-1 text-[11px] opacity-90">Karar Notu: {data.dispute.resolutionNote}</div>
                  )}
                </div>
              </div>
            )}

            {/* Parties & Event Info */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="p-4 rounded-2xl bg-[#f8fafc] dark:bg-[#0f1c38] border border-[#e2e8f0] dark:border-[#1e335a] space-y-1.5">
                <div className="text-[10px] font-bold uppercase tracking-wider text-[#64748b] dark:text-slate-400 flex items-center gap-1.5">
                  <Building2 className="w-3.5 h-3.5 text-[#f25922]" />
                  <span>İşveren / Kurum</span>
                </div>
                <div className="font-bold text-sm text-[#0f172a] dark:text-white">
                  {data.businessInfo?.officialTitle || data.booking.businessName}
                </div>
                {data.businessInfo?.taxNumber && (
                  <div className="text-[11px] text-[#475569] dark:text-slate-300">
                    VD: {data.businessInfo.taxOffice || 'Belirtilmemiş'} · VKN: {data.businessInfo.taxNumber}
                  </div>
                )}
                <div className="text-[11px] text-[#64748b] dark:text-slate-400">
                  Mekân: {data.booking.venueName} ({data.booking.city})
                </div>
              </div>

              <div className="p-4 rounded-2xl bg-[#f8fafc] dark:bg-[#0f1c38] border border-[#e2e8f0] dark:border-[#1e335a] space-y-1.5">
                <div className="text-[10px] font-bold uppercase tracking-wider text-[#64748b] dark:text-slate-400 flex items-center gap-1.5">
                  <UserCheck className="w-3.5 h-3.5 text-[#f25922]" />
                  <span>İcracı &amp; Etkinlik</span>
                </div>
                <div className="font-bold text-sm text-[#0f172a] dark:text-white">
                  {data.booking.performerName}
                </div>
                <div className="text-[11px] text-[#475569] dark:text-slate-300">
                  İlan: {data.booking.listingTitle}
                </div>
                <div className="text-[11px] text-[#64748b] dark:text-slate-400 tabular-nums">
                  Tarih: {data.booking.eventDate}
                  {data.booking.startTime && data.booking.endTime
                    ? ` (${data.booking.startTime} - ${data.booking.endTime})`
                    : ''}
                </div>
              </div>
            </div>

            {/* Commission Model Breakdown */}
            <div className="p-4 rounded-2xl bg-white dark:bg-[#0f1c38] border border-[#e2e8f0] dark:border-[#1e335a] space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-bold text-[#0f172a] dark:text-white">
                  Finansal Mutabakat Özeti
                </span>
                <span className="text-[11px] font-semibold text-[#f25922]">
                  {data.summary.commissionModelLabel}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-3 text-xs pt-2 border-t border-[#e2e8f0] dark:border-[#1e335a]">
                <div>
                  <div className="text-[10px] text-[#64748b] dark:text-slate-400">Net İcracı Hakedişi</div>
                  <div className="text-sm sm:text-base font-extrabold text-emerald-700 dark:text-emerald-400 tabular-nums">
                    {formatCurrencyTRY(data.summary.netPerformerPayout)}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-[#64748b] dark:text-slate-400">Platform Komisyonu</div>
                  <div className="text-sm sm:text-base font-extrabold text-[#f25922] tabular-nums">
                    {formatCurrencyTRY(data.summary.platformCommissionAmount)}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-[#64748b] dark:text-slate-400">İşveren Toplam Ödeme</div>
                  <div className="text-sm sm:text-base font-extrabold text-[#0f172a] dark:text-white tabular-nums">
                    {formatCurrencyTRY(data.summary.employerGrossTotal)}
                  </div>
                </div>
              </div>
            </div>

            {/* Digital Contract & Acceptance Timestamps */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold text-[#0f172a] dark:text-white flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5 text-[#f25922]" />
                  <span>{data.contract?.title || 'Dijital İcra Sözleşmesi Hükümleri'}</span>
                </h4>
                <span className="text-[11px] font-semibold text-[#64748b] dark:text-slate-400">
                  Rezervasyon: {data.booking.id}
                </span>
              </div>

              <pre className="whitespace-pre-wrap text-xs text-[#475569] dark:text-slate-300 bg-[#f8fafc] dark:bg-[#0f1c38] p-4 rounded-2xl border border-[#e2e8f0] dark:border-[#1e335a] font-sans leading-relaxed">
                {data.contract?.termsText || 'Sözleşme metni henüz oluşturulmamış.'}
              </pre>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-[11px]">
                <div className="p-2.5 rounded-xl bg-[#f8fafc] dark:bg-[#0f1c38] border border-[#e2e8f0] dark:border-[#1e335a] flex items-center gap-2">
                  {data.booking.contractTermsAcceptedByEmployer ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  ) : (
                    <Clock className="w-4 h-4 text-amber-500 shrink-0" />
                  )}
                  <div>
                    <div className="font-bold text-[#0f172a] dark:text-white">İşveren Sözleşme Onayı</div>
                    <div className="text-[#64748b] dark:text-slate-400 tabular-nums">
                      {data.contract?.employerAcceptedAt
                        ? new Date(data.contract.employerAcceptedAt).toLocaleString('tr-TR')
                        : data.booking.contractTermsAcceptedByEmployer
                        ? 'Onaylandı'
                        : 'Onay Bekleniyor'}
                    </div>
                  </div>
                </div>

                <div className="p-2.5 rounded-xl bg-[#f8fafc] dark:bg-[#0f1c38] border border-[#e2e8f0] dark:border-[#1e335a] flex items-center gap-2">
                  {data.booking.contractTermsAcceptedByPerformer ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  ) : (
                    <Clock className="w-4 h-4 text-amber-500 shrink-0" />
                  )}
                  <div>
                    <div className="font-bold text-[#0f172a] dark:text-white">İcracı Sözleşme Onayı</div>
                    <div className="text-[#64748b] dark:text-slate-400 tabular-nums">
                      {data.contract?.performerAcceptedAt
                        ? new Date(data.contract.performerAcceptedAt).toLocaleString('tr-TR')
                        : data.booking.contractTermsAcceptedByPerformer
                        ? 'Onaylandı'
                        : 'Onay Bekleniyor'}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Financial Ledger Timeline */}
            <div className="space-y-2">
              <h4 className="text-xs font-bold text-[#0f172a] dark:text-white flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                <span>Güvence Havuzu Finansal Defter Hareketleri ({data.ledgerEntries.length})</span>
              </h4>

              {data.ledgerEntries.length === 0 ? (
                <div className="p-3 rounded-xl bg-[#f8fafc] dark:bg-[#0f1c38] border border-[#e2e8f0] dark:border-[#1e335a] text-[11px] text-[#64748b] dark:text-slate-400">
                  Henüz ödeme havuzu hareketi kaydedilmemiş. Sözleşme her iki tarafça onaylandıktan sonra güvence ödemesi yapılabilir.
                </div>
              ) : (
                <div className="space-y-2">
                  {data.ledgerEntries.map((entry) => (
                    <div
                      key={entry.id}
                      className="p-3 rounded-xl bg-[#f8fafc] dark:bg-[#0f1c38] border border-[#e2e8f0] dark:border-[#1e335a] flex flex-wrap items-center justify-between gap-2 text-xs"
                    >
                      <div>
                        <div className="font-bold text-[#0f172a] dark:text-white">
                          {LEDGER_LABELS[entry.entryType] || entry.entryType}
                        </div>
                        <div className="text-[11px] text-[#64748b] dark:text-slate-400">
                          {entry.notes} · Ref: {entry.providerRef} ({entry.mode})
                        </div>
                      </div>
                      <div className="text-right tabular-nums">
                        <div className="font-extrabold text-[#0f172a] dark:text-white">
                          {formatCurrencyTRY(entry.amount)}
                        </div>
                        <div className="text-[10px] text-[#64748b] dark:text-slate-400">
                          {new Date(entry.createdAt).toLocaleString('tr-TR')}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {data.contract?.disclaimer && (
              <div className="text-[11px] text-amber-900 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 p-3 rounded-xl leading-relaxed">
                {data.contract.disclaimer}
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
};
