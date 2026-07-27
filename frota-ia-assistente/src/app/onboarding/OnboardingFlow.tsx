"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { LogoMark } from "@/components/icons/Logo";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { cn } from "@/lib/utils";
import {
  createCompanyAction,
  createVehicleAction,
  skipVehicleAction,
  type OnboardingActionState,
} from "./actions";

const EMPTY_STATE: OnboardingActionState = {};

const selectClass = cn(
  "flex h-10 w-full rounded-lg border border-border bg-surface px-3.5 text-sm text-foreground",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-transparent"
);

const labelClass = "mb-1.5 block text-sm font-medium text-foreground";

function SubmitButton({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" className="w-full" isLoading={pending}>
      {children}
    </Button>
  );
}

export function OnboardingFlow({ companyName }: { companyName: string | null }) {
  const step: 1 | 2 = companyName ? 2 : 1;

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4 py-10">
      <Card className="w-full max-w-md p-8">
        <div className="mb-6 flex items-center gap-3">
          <LogoMark className="size-9" />
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Passo {step} de 2
            </p>
            <h1 className="text-base font-semibold text-foreground">
              {step === 1 ? "Sobre sua operação" : "Seu primeiro veículo"}
            </h1>
          </div>
        </div>

        {step === 1 ? <CompanyStep /> : <VehicleStep companyName={companyName as string} />}
      </Card>
    </div>
  );
}

function CompanyStep() {
  const [state, formAction] = useActionState(createCompanyAction, EMPTY_STATE);

  return (
    <form action={formAction} className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Como o Frota IA deve chamar sua empresa ou operação? Isso separa seus dados de qualquer
        outra empresa no sistema.
      </p>

      <div>
        <label htmlFor="name" className={labelClass}>
          Nome da empresa (ou o seu, se for autônomo)
        </label>
        <Input id="name" name="name" placeholder="Ex.: Transportes Silva, ou João Autônomo" required autoFocus />
      </div>

      <div>
        <label htmlFor="companyType" className={labelClass}>
          Tipo de operação
        </label>
        <select id="companyType" name="companyType" defaultValue="autonomo" className={selectClass}>
          <option value="autonomo">Autônomo</option>
          <option value="transportadora">Transportadora</option>
          <option value="embarcador">Embarcador</option>
          <option value="outro">Outro</option>
        </select>
      </div>

      {state.error && <p className="text-sm text-danger">{state.error}</p>}

      <SubmitButton>Continuar</SubmitButton>
    </form>
  );
}

function VehicleStep({ companyName }: { companyName: string }) {
  const [state, formAction] = useActionState(createVehicleAction, EMPTY_STATE);

  return (
    <form action={formAction} className="space-y-4">
      <p className="text-sm text-muted-foreground">
        <span className="font-medium text-foreground">{companyName}</span> criada. Agora cadastre
        um veículo — o Frota IA vai usar esses dados para não te perguntar de novo em toda
        conversa.
      </p>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="name" className={labelClass}>
            Apelido do veículo
          </label>
          <Input id="name" name="name" placeholder="Ex.: FH 540" />
        </div>
        <div>
          <label htmlFor="plate" className={labelClass}>
            Placa
          </label>
          <Input id="plate" name="plate" placeholder="ABC1D23" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="vehicleType" className={labelClass}>
            Tipo
          </label>
          <select id="vehicleType" name="vehicleType" defaultValue="" className={selectClass}>
            <option value="">Não informar</option>
            <option value="utilitario">Utilitário</option>
            <option value="tres_quartos">3/4</option>
            <option value="toco">Toco</option>
            <option value="truck">Truck</option>
            <option value="cavalo_mecanico">Cavalo mecânico</option>
            <option value="carreta">Carreta</option>
            <option value="bitrem">Bitrem</option>
            <option value="rodotrem">Rodotrem</option>
            <option value="onibus">Ônibus</option>
            <option value="outro">Outro</option>
          </select>
        </div>
        <div>
          <label htmlFor="fuelType" className={labelClass}>
            Combustível
          </label>
          <select id="fuelType" name="fuelType" defaultValue="" className={selectClass}>
            <option value="">Não informar</option>
            <option value="diesel_s10">Diesel S10</option>
            <option value="diesel_s500">Diesel S500</option>
            <option value="gasolina">Gasolina</option>
            <option value="etanol">Etanol</option>
            <option value="eletrico">Elétrico</option>
            <option value="outro">Outro</option>
          </select>
        </div>
      </div>

      <div>
        <label htmlFor="averageConsumptionKmL" className={labelClass}>
          Consumo médio (km/l) — opcional
        </label>
        <Input id="averageConsumptionKmL" name="averageConsumptionKmL" type="number" step="0.1" min="0" placeholder="Ex.: 2.8" />
      </div>

      {state.error && <p className="text-sm text-danger">{state.error}</p>}

      <SubmitButton>Salvar veículo e começar</SubmitButton>

      <button
        type="submit"
        formAction={skipVehicleAction}
        className="w-full text-center text-sm text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
      >
        Cadastrar depois
      </button>
    </form>
  );
}
